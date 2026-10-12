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
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { MapPreferencesProvider } from '@/features/settings/stores/MapPreferencesContext';
import { useAuthStore } from '@/shared/app/AuthStore';

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
  return { getAllSlides: () => slides, getTutorialSlides: () => slides, getSlidesSince: () => [] };
});

const visible = { includeHiddenElements: false } as const;
const TITLES = ['tour.lighthouse', 'tour.harbour', 'tour.jetty'];

function openTour() {
  useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  render(
    <MapPreferencesProvider>
      <WhatsNewModal />
    </MapPreferencesProvider>
  );
  expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');
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
