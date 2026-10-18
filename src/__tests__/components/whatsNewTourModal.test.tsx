/**
 * Scenario: the tour was an absolute overlay in the app's own window. Android back
 * went to the navigator underneath, the tab bar drew over its scrim, every slide sat
 * in the accessibility tree at once, and the footer faded the buttons that did not
 * apply to opacity 0 while leaving them pressable: on the first slide an invisible
 * Done ended the tour.
 *
 * Expected behaviour: the tour is a modal window that back closes, only the slide in
 * view is exposed, the footer holds only the buttons that apply to that slide, and
 * the position is a value a screen reader can read and adjust.
 */
import React from 'react';
import { Modal } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { MapPreferencesProvider } from '@/features/settings/stores/MapPreferencesContext';
import { useAuthStore } from '@/shared/app/AuthStore';
import { flattenStyle } from '@/shared/ui/flattenStyle';
import { layout, spacing } from '@/theme';

const mockWindow = { width: 750, height: 1334, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ ...mockWindow }),
}));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/settings/components/whatsNew/WhatsNewSlide', () => {
  const { Text: PaperText } = jest.requireActual('react-native-paper');
  return {
    WhatsNewSlide: ({ title }: { title: string }) => <PaperText>{title}</PaperText>,
  };
});

jest.mock('@/features/settings/components/whatsNew/slides', () => {
  const Empty = () => null;
  const slides = [
    { titleKey: 'tour.lighthouse', bodyKey: 'tour.lighthouseBody', icon: 'star', showMeRoute: '/' },
    { titleKey: 'tour.harbour', bodyKey: 'tour.harbourBody', icon: 'star' },
    { titleKey: 'tour.jetty', bodyKey: 'tour.jettyBody', icon: 'star', showMeRoute: '/' },
  ].map((slide) => ({ ...slide, Component: Empty }));
  return {
    getAllSlides: () => slides,
    getTutorialSlides: () => slides,
    getTutorialSlidesFor: () => slides,
    getSlidesSince: () => [],
  };
});

const visible = { includeHiddenElements: false } as const;
const TITLES = ['tour.lighthouse', 'tour.harbour', 'tour.jetty'];

function tourTree() {
  return (
    <MapPreferencesProvider>
      <WhatsNewModal />
    </MapPreferencesProvider>
  );
}

function openTour() {
  useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  useWhatsNewStore.getState().startTour('tutorial');
  render(tourTree());
}

function buttonNames() {
  return screen
    .getAllByRole('button', visible)
    .map((button) => button.props.accessibilityLabel ?? '')
    .filter((name: string) => name.startsWith('whatsNew.'))
    .sort();
}

function exposedTitles() {
  return TITLES.filter((title) => screen.queryByText(title, visible) !== null);
}

describe('the tour as a modal', () => {
  it('presents in its own window and closes on system back', () => {
    openTour();

    const modal = screen.UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    expect(screen.getByTestId('whats-new-card').props.accessibilityViewIsModal).toBe(true);

    act(() => {
      modal.props.onRequestClose();
    });
    expect(useWhatsNewStore.getState().tourState).toBeNull();
  });

  it('offers Skip, Show me and Next on the first slide and nothing that is not shown', () => {
    openTour();

    expect(buttonNames()).toStrictEqual([
      'whatsNew.nextButton',
      'whatsNew.showMeButton',
      'whatsNew.skipButton',
    ]);
    expect(exposedTitles()).toStrictEqual(['tour.lighthouse']);
  });

  it('drops Show me on a slide with nowhere to show', () => {
    openTour();
    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.nextButton' }));

    expect(buttonNames()).toStrictEqual(['whatsNew.nextButton', 'whatsNew.skipButton']);
    expect(exposedTitles()).toStrictEqual(['tour.harbour']);
  });

  it('offers Done and no Next or Skip on the last slide, and Done ends the tour', () => {
    openTour();
    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.nextButton' }));
    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.nextButton' }));

    expect(buttonNames()).toStrictEqual(['whatsNew.doneButton', 'whatsNew.showMeButton']);
    expect(exposedTitles()).toStrictEqual(['tour.jetty']);

    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.doneButton' }));
    expect(useWhatsNewStore.getState().tourState).toBeNull();
  });

  it('reports the position and moves with the adjust actions', () => {
    openTour();

    const pager = () => screen.getByRole('adjustable', visible);
    expect(pager().props.accessibilityValue).toMatchObject({ min: 1, max: 3, now: 1 });

    fireEvent(pager(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(pager().props.accessibilityValue).toMatchObject({ now: 2 });
    expect(exposedTitles()).toStrictEqual(['tour.harbour']);

    fireEvent(pager(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    fireEvent(pager(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(pager().props.accessibilityValue).toMatchObject({ now: 1 });
    expect(useWhatsNewStore.getState().tourState).not.toBeNull();
  });
});

function layOutFooter(row: number, widths: { skip: number; showMe: number; next: number }) {
  const layout = (width: number) => ({
    nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } },
  });
  // The footer pads its row by 24 on each side.
  fireEvent(screen.getByTestId('whats-new-footer'), 'layout', layout(row + 48));
  fireEvent(screen.getByTestId('whats-new-skip-slot'), 'layout', layout(widths.skip));
  fireEvent(screen.getByTestId('whats-new-show-me-slot'), 'layout', layout(widths.showMe));
  fireEvent(screen.getByTestId('whats-new-next-slot'), 'layout', layout(widths.next));
}

describe('the tour footer on a narrow card', () => {
  it('keeps Skip, Show me and Next in one row when they fit', () => {
    openTour();
    layOutFooter(248, { skip: 52, showMe: 96, next: 60 });

    expect(screen.queryByTestId('whats-new-show-me-row')).toBeNull();
    const row = within(screen.getByTestId('whats-new-nav-row'));
    expect(row.getByTestId('whats-new-skip')).toBeTruthy();
    expect(row.getByTestId('whats-new-show-me')).toBeTruthy();
    expect(row.getByTestId('whats-new-next')).toBeTruthy();
  });

  it('puts Show me in a row of its own above Skip and Next when the labels do not fit', () => {
    openTour();
    layOutFooter(208, { skip: 106, showMe: 100, next: 62 });

    const showMeRow = screen.getByTestId('whats-new-show-me-row');
    expect(within(showMeRow).getByTestId('whats-new-show-me')).toBeTruthy();
    expect(within(showMeRow).queryByTestId('whats-new-skip')).toBeNull();
    expect(within(showMeRow).queryByTestId('whats-new-next')).toBeNull();

    const navRow = screen.getByTestId('whats-new-nav-row');
    expect(within(navRow).getByTestId('whats-new-skip')).toBeTruthy();
    expect(within(navRow).getByTestId('whats-new-next')).toBeTruthy();
    expect(within(navRow).queryByTestId('whats-new-show-me')).toBeNull();

    const footer = screen.getByTestId('whats-new-footer');
    const order = footer.children.map((child) =>
      typeof child === 'string' ? child : child.props.testID
    );
    expect(order.indexOf('whats-new-show-me-row')).toBeLessThan(order.indexOf('whats-new-nav-row'));

    fireEvent.press(screen.getByTestId('whats-new-show-me'));
    expect(useWhatsNewStore.getState().tourState?.exploring).toBe(true);
  });

  it('keeps the stacked footer, and Done in it, on the last slide', () => {
    openTour();
    layOutFooter(208, { skip: 106, showMe: 100, next: 62 });
    fireEvent.press(screen.getByTestId('whats-new-next'));
    fireEvent.press(screen.getByTestId('whats-new-next'));

    expect(screen.getByTestId('whats-new-show-me-row')).toBeTruthy();
    expect(
      within(screen.getByTestId('whats-new-nav-row')).getByTestId('whats-new-done')
    ).toBeTruthy();
    expect(screen.queryByTestId('whats-new-skip')).toBeNull();
  });
});

describe('the tour when the window changes width', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    mockWindow.width = 750;
    jest.useRealTimers();
  });

  const rowOffset = () =>
    flattenStyle(getAnimatedStyle(screen.getByTestId('whats-new-slide-row'))).transform?.[0];

  it('keeps the current slide in view after a fold, split or rotation', () => {
    openTour();
    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.nextButton' }));
    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.nextButton' }));
    act(() => advanceAnimationByTime(300));
    // At 750 the card is held to the readable column.
    expect(rowOffset()).toEqual({ translateX: -layout.maxContentWidth * 2 });

    mockWindow.width = 500;
    screen.rerender(tourTree());
    act(() => advanceAnimationByTime(300));

    expect(rowOffset()).toEqual({ translateX: -(500 - spacing.xl * 2) * 2 });
    expect(exposedTitles()).toStrictEqual(['tour.jetty']);
  });

  it('snaps without an animation, so no frame shows two slides', () => {
    openTour();
    fireEvent.press(screen.getByRole('button', { name: 'whatsNew.nextButton' }));
    act(() => advanceAnimationByTime(300));

    mockWindow.width = 500;
    screen.rerender(tourTree());
    act(() => advanceAnimationByTime(0));

    expect(rowOffset()).toEqual({ translateX: -(500 - spacing.xl * 2) });
  });
});
