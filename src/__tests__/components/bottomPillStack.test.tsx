/**
 * Scenario: the recording return pill and the tour return pill each set their own offset above
 * the tab bar, so a tour explored while a ride waits for review drew both on one spot, and on the
 * feed the record button sat in the same band.
 *
 * Expected behaviour: one stack places every bottom pill, the first `spacing.md` above the bar and
 * above whatever the screen draws over its foot, each next one `spacing.xs` above the one below.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { RecordFAB } from '@/features/recording/components/RecordFAB';
import { RecordingReturnPill } from '@/features/recording/components/RecordingReturnPill';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { TourReturnPill } from '@/features/settings/components/whatsNew/TourReturnPill';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { BottomPillStack } from '@/shared/ui/BottomPillStack';
import { useBottomPills } from '@/shared/ui/bottomPills';
import { TAB_BAR_SAFE_PADDING, bottomPillStack } from '@/shared/ui/tabBarClearance';
import { layout, spacing } from '@/theme';

let mockFocused = true;

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['(tabs)'],
  usePathname: () => '/',
  useIsFocused: () => mockFocused,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn() }));

type Rendered = Awaited<ReturnType<typeof render>>;

const CLEARANCE = TAB_BAR_SAFE_PADDING + 34;
const FAB_COVER = spacing.md + layout.recordFabSize;

describe('bottomPillStack', () => {
  it('places one pill spacing.md above the clearance', () => {
    expect(bottomPillStack({ clearance: 114, cover: 0, heights: [44] })).toEqual([
      114 + spacing.md,
    ]);
  });

  it('places the next pill its neighbour height plus spacing.xs above', () => {
    expect(bottomPillStack({ clearance: 114, cover: 0, heights: [44, 72] })).toEqual([
      114 + spacing.md,
      114 + spacing.md + 44 + spacing.xs,
    ]);
  });

  it('lifts the whole stack over the record button', () => {
    expect(bottomPillStack({ clearance: 114, cover: FAB_COVER, heights: [44, 72] })).toEqual([
      114 + FAB_COVER + spacing.md,
      114 + FAB_COVER + spacing.md + 44 + spacing.xs,
    ]);
  });

  it('places nothing when no pill shows', () => {
    expect(bottomPillStack({ clearance: 114, cover: 0, heights: [] })).toEqual([]);
  });
});

function bottomOf(view: Rendered, id: string) {
  return StyleSheet.flatten(view.getByTestId(id).props.style).bottom as number;
}

async function layOut(view: Rendered, id: string, height: number) {
  await act(() =>
    fireEvent(view.getByTestId(id), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height } },
    })
  );
}

function stack() {
  return (
    <BottomPillStack pills={{ recording: <RecordingReturnPill />, tour: <TourReturnPill /> }} />
  );
}

describe('the bottom pill stack', () => {
  beforeEach(() => {
    mockFocused = true;
    useBottomPills.setState({ heights: {}, covers: {} });
    useRecordingStore.getState().reset();
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    useWhatsNewStore.setState({ tourState: { exploring: true } } as never);
  });

  it('stacks a ride waiting for review and a tour without overlap', async () => {
    const view = await render(stack());
    expect(view.getByTestId('recording-return-pill')).toBeTruthy();
    expect(view.getByText('whatsNew.backToTour')).toBeTruthy();

    await layOut(view, 'bottom-pill-recording', 44);
    await layOut(view, 'bottom-pill-tour', 72);

    const ride = bottomOf(view, 'bottom-pill-recording');
    const tour = bottomOf(view, 'bottom-pill-tour');
    expect(ride).toBe(CLEARANCE + spacing.md);
    expect(tour).not.toBe(ride);
    expect(tour).toBeGreaterThanOrEqual(ride + 44 + spacing.xs);
  });

  it('closes the gap when the lower pill goes', async () => {
    const view = await render(stack());
    await layOut(view, 'bottom-pill-recording', 44);
    await layOut(view, 'bottom-pill-tour', 72);

    await act(() => useAuthStore.setState({ isAuthenticated: false }));
    await layOut(view, 'bottom-pill-recording', 0);

    expect(view.queryByTestId('recording-return-pill')).toBeNull();
    expect(bottomOf(view, 'bottom-pill-tour')).toBe(CLEARANCE + spacing.md);
  });

  it('rises over the record button while it shows, and drops back when it goes', async () => {
    const fab = await render(<RecordFAB />);
    const view = await render(stack());
    await layOut(view, 'bottom-pill-recording', 44);

    expect(bottomOf(view, 'bottom-pill-recording')).toBe(CLEARANCE + FAB_COVER + spacing.md);

    await fab.unmount();
    expect(bottomOf(view, 'bottom-pill-recording')).toBe(CLEARANCE + spacing.md);
  });

  it('ignores the record button on a screen that is not in front', async () => {
    mockFocused = false;
    await render(<RecordFAB />);
    const view = await render(stack());
    await layOut(view, 'bottom-pill-recording', 44);

    expect(bottomOf(view, 'bottom-pill-recording')).toBe(CLEARANCE + spacing.md);
  });

  it('ignores the record button while it hides for a running session', async () => {
    useRecordingStore.getState().reset();
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await render(<RecordFAB />);
    const view = await render(stack());
    await layOut(view, 'bottom-pill-recording', 44);

    expect(bottomOf(view, 'bottom-pill-recording')).toBe(CLEARANCE + spacing.md);
  });
});
