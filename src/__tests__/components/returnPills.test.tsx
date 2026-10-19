/**
 * Scenario: the recording and tour return pills and the terrain notice each drew a pill of their
 * own, with their own radius, shadow, dot and buttons.
 *
 * Expected behaviour: all three draw the one floating pill. The recording pill is its action
 * variant, a button with the record dot at 10 in the record role and the live elapsed time in
 * tabular figures. The tour pill presses back to the tour and closes it through an accessible action or a
 * long press. The terrain notice is a status pill that passes touches through and still clears
 * itself.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { RecordingReturnPill } from '@/features/recording/components/RecordingReturnPill';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { TourReturnPill } from '@/features/settings/components/whatsNew/TourReturnPill';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import {
  TerrainUnavailableNotice,
  TERRAIN_UNAVAILABLE_TEST_ID,
} from '@/features/maps/components/TerrainUnavailableNotice';
import { useAuthStore } from '@/shared/app/AuthStore';
import { brand, colors, darkColors, layout, raised, recording } from '@/theme';

let mockIsDark = false;
let mockPathname = '/';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  usePathname: () => mockPathname,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

type Rendered = Awaited<ReturnType<typeof render>>;

/** Every colour any node in the tree is drawn with. */
function coloursDrawn(view: Rendered): unknown[] {
  return view.UNSAFE_root.findAll(() => true).flatMap((node) => {
    const style = StyleSheet.flatten(node.props.style as never) as Record<string, unknown> | null;
    return [style?.backgroundColor, style?.color, node.props.color].filter(Boolean);
  });
}

afterEach(() => {
  mockIsDark = false;
  mockPathname = '/';
});

describe('the recording return pill', () => {
  beforeEach(() => {
    useRecordingStore.getState().reset();
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    useRecordingStore.getState().startRecording('Ride', 'gps');
  });

  it.each([
    ['light', false],
    ['dark', true],
  ] as const)(
    'draws the record dot at 10 and the elapsed time in tabular figures in the %s theme',
    async (tone, isDark) => {
      mockIsDark = isDark;
      const view = await render(<RecordingReturnPill />);

      const dot = StyleSheet.flatten(view.getByTestId('recording-return-pill-dot').props.style);
      expect(dot.width).toBe(10);
      expect(dot.height).toBe(10);
      expect(dot.backgroundColor).toBe(recording[tone]);

      const elapsed = StyleSheet.flatten(
        view.getByTestId('recording-return-pill-elapsed').props.style
      );
      expect(elapsed.fontVariant).toContain('tabular-nums');

      const drawn = coloursDrawn(view);
      expect(drawn).not.toContain(brand.blue);
      expect(drawn).not.toContain((isDark ? darkColors : colors).actionPrimary);
      expect(
        StyleSheet.flatten(view.getByText('recording.status.recording').props.style).color
      ).toBe(recording[tone]);
    }
  );

  it('is one button that reads the shared pill shape, shadow and dark edge', async () => {
    mockIsDark = true;
    const view = await render(<RecordingReturnPill />);
    const pill = view.getByTestId('recording-return-pill');

    expect(pill.props.accessibilityRole).toBe('button');
    const style = StyleSheet.flatten(
      typeof pill.props.style === 'function'
        ? pill.props.style({ pressed: false })
        : pill.props.style
    );
    expect(style.borderRadius).toBe(layout.borderRadiusFull);
    expect(style).toMatchObject(raised('pill', true));
    expect(style.borderColor).toBe(darkColors.cardEdge);
  });
  /**
   * Scenario: the live screen pushes the field picker, a sheet route, so the
   * pathname is the sheet's while the ride is still the screen under it.
   *
   * Expected behaviour: no pill offers a way back to the screen on display,
   * and one shows once a sheet covers any other screen.
   */
  it('stays hidden under a sheet opened over the recording screen', async () => {
    mockPathname = '/recording/Ride';
    const view = await render(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).toBeNull();

    mockPathname = '/sheets/field-picker';
    await view.rerender(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).toBeNull();

    mockPathname = '/map';
    await view.rerender(<RecordingReturnPill />);
    mockPathname = '/sheets/section-chooser';
    await view.rerender(<RecordingReturnPill />);
    expect(view.getByTestId('recording-return-pill')).toBeTruthy();
  });
});

describe('the tour return pill', () => {
  const resumeTour = jest.fn();
  const dismissTour = jest.fn();

  beforeEach(() => {
    resumeTour.mockClear();
    dismissTour.mockClear();
    useWhatsNewStore.setState({
      tourState: { exploring: true, tip: null } as never,
      resumeTour,
      dismissTour,
    });
  });

  it('presses back to the tour', async () => {
    const view = await render(<TourReturnPill />);
    const pill = view.getByTestId('tour-return-pill');

    expect(pill.props.accessibilityRole).toBe('button');
    expect(pill.props.accessibilityLabel).toBe('whatsNew.backToTour');
    await fireEvent.press(pill);
    expect(resumeTour).toHaveBeenCalledTimes(1);
    expect(dismissTour).not.toHaveBeenCalled();
  });

  it('closes the tour through an accessible action', async () => {
    const view = await render(<TourReturnPill />);
    const pill = view.getByTestId('tour-return-pill');

    expect(pill.props.accessibilityActions).toEqual([
      { name: 'longpress', label: 'whatsNew.closeTour' },
    ]);
    await fireEvent(pill, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(dismissTour).toHaveBeenCalledTimes(1);
    expect(resumeTour).not.toHaveBeenCalled();
  });

  it('closes the tour on a long press', async () => {
    const view = await render(<TourReturnPill />);

    await fireEvent(view.getByTestId('tour-return-pill'), 'longPress');
    expect(dismissTour).toHaveBeenCalledTimes(1);
    expect(resumeTour).not.toHaveBeenCalled();
  });

  it('draws no buttons of its own', async () => {
    const view = await render(<TourReturnPill />);

    expect(view.queryByText('whatsNew.closeTour')).toBeNull();
    expect(view.getAllByRole('button')).toHaveLength(1);
  });
});

describe('the terrain notice', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is a status pill that passes touches through and clears itself', async () => {
    const onDismiss = jest.fn();
    const view = await render(<TerrainUnavailableNotice onDismiss={onDismiss} />);
    const notice = view.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID);

    expect(notice.props.pointerEvents).toBe('none');
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    expect(view.queryAllByRole('button')).toHaveLength(0);
    expect(StyleSheet.flatten(notice.props.style)).toMatchObject(raised('pill', false));

    jest.advanceTimersByTime(6000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
