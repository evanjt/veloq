/**
 * Scenario: the launch after a quarantine. `takeQuarantineReport` answers once
 * and clears itself, so anything that reads it twice loses the message.
 *
 * Expected behaviour: the card reads it once per mount, shows only when
 * something was salvaged, and dismisses for good.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { LibraryRebuiltNotice } from '@/features/settings/components/LibraryRebuiltNotice';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars && typeof vars.count === 'number') return `${key}:${vars.count}`;
      if (vars && typeof vars.kept === 'string') return `${key}(${vars.kept})`;
      return key;
    },
  }),
}));

const mockTake = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ takeQuarantineReport: () => mockTake() }),
  isEngineReady: () => true,
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const none = { history: 0, geometry: 0, pins: 0, sections: 0, intents: 0 };

beforeEach(() => {
  mockTake.mockReset().mockReturnValue(null);
});

describe('LibraryRebuiltNotice', () => {
  it('shows nothing when this launch opened the file it was given', () => {
    const { queryByTestId } = render(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });

  it('shows nothing when the rebuild rescued nothing', () => {
    mockTake.mockReturnValue(none);
    const { queryByTestId } = render(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });

  it('names what was kept when something came across', () => {
    mockTake.mockReturnValue({ ...none, sections: 14, history: 92 });
    const { getByTestId } = render(<LibraryRebuiltNotice />);
    expect(getByTestId('library-rebuilt-notice')).toBeTruthy();
    expect(getByTestId('library-rebuilt-kept').props.children).toContain(
      'engine.quarantine.kept.sections:14'
    );
  });

  it('asks the engine once per mount, because the read clears it', () => {
    mockTake.mockReturnValue({ ...none, sections: 1 });
    const { rerender } = render(<LibraryRebuiltNotice />);
    rerender(<LibraryRebuiltNotice />);
    rerender(<LibraryRebuiltNotice />);
    expect(mockTake).toHaveBeenCalledTimes(1);
  });

  it('stays dismissed', () => {
    mockTake.mockReturnValue({ ...none, sections: 1 });
    const { getByTestId, queryByTestId, rerender } = render(<LibraryRebuiltNotice />);
    fireEvent.press(getByTestId('library-rebuilt-dismiss'));
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
    rerender(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });

  it('survives an engine that is not there', () => {
    mockTake.mockImplementation(() => {
      throw new Error('not initialised');
    });
    const { queryByTestId } = render(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });
});
