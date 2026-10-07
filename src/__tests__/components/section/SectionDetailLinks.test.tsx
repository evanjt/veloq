import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionDetailLinks } from '@/features/routes/components/section/SectionDetailLinks';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SectionDetailLinks', () => {
  it('opens the lap and history pages for the current section', () => {
    const openLaps = jest.fn();
    const openHistory = jest.fn();
    const view = render(
      <SectionDetailLinks
        hasLaps
        historyCount={3}
        onOpenLaps={openLaps}
        onOpenHistory={openHistory}
      />
    );

    fireEvent.press(view.getByTestId('section-open-laps'));
    fireEvent.press(view.getByTestId('section-open-history'));

    expect(openLaps).toHaveBeenCalledTimes(1);
    expect(openHistory).toHaveBeenCalledTimes(1);
  });

  it('shows history alone when there are no repeated laps', () => {
    const view = render(
      <SectionDetailLinks
        hasLaps={false}
        historyCount={0}
        onOpenLaps={jest.fn()}
        onOpenHistory={jest.fn()}
      />
    );
    expect(view.queryByTestId('section-open-laps')).toBeNull();
    expect(view.getByTestId('section-open-history')).toBeTruthy();
  });

  it('puts the history entry count on the history link', () => {
    const view = render(
      <SectionDetailLinks
        hasLaps={false}
        historyCount={12}
        onOpenLaps={jest.fn()}
        onOpenHistory={jest.fn()}
      />
    );
    expect(view.getByText('sectionHistory.title · 12')).toBeTruthy();
  });

  it('leaves the count off when the section has no history entries', () => {
    const view = render(
      <SectionDetailLinks
        hasLaps={false}
        historyCount={0}
        onOpenLaps={jest.fn()}
        onOpenHistory={jest.fn()}
      />
    );
    expect(view.getByText('sectionHistory.title')).toBeTruthy();
  });
});
