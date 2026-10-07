/**
 * Scenario: the launch after a quarantine. `takeQuarantineReport` answers once
 * and clears itself, so anything that reads it twice loses the message.
 *
 * Expected behaviour: each engine open reads it once, the card shows for every
 * quarantine, naming what was kept when anything was, and dismisses for good.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { LibraryRebuiltNotice } from '@/features/settings/components/LibraryRebuiltNotice';
import {
  captureQuarantineReport,
  clearQuarantineReport,
} from '@/features/settings/lib/quarantineReport';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
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
  getRouteDbPath: () => null,
  isEngineReady: () => true,
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const none = {
  history: 0,
  geometry: 0,
  pins: 0,
  sections: 0,
  intents: 0,
  recordings: 0,
  routeNames: 0,
};

beforeEach(() => {
  mockTake.mockReset().mockReturnValue(null);
  clearQuarantineReport();
});

describe('LibraryRebuiltNotice', () => {
  it('shows nothing when this launch opened the file it was given', () => {
    const { queryByTestId } = render(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });

  it('says the library was rebuilt when the rebuild rescued nothing', () => {
    mockTake.mockReturnValue(none);
    captureQuarantineReport();
    const { getByTestId, getByText, queryByTestId } = render(<LibraryRebuiltNotice />);
    expect(getByTestId('library-rebuilt-notice')).toBeTruthy();
    expect(queryByTestId('library-rebuilt-kept')).toBeNull();
    expect(getByText('engine.quarantine.keptNothing')).toBeTruthy();
    expect(getByText('engine.quarantine.resyncing')).toBeTruthy();
  });

  it('dismisses the rebuilt card for good when nothing was kept', () => {
    mockTake.mockReturnValue(none);
    captureQuarantineReport();
    const { getByTestId, queryByTestId, rerender } = render(<LibraryRebuiltNotice />);
    fireEvent.press(getByTestId('library-rebuilt-dismiss'));
    rerender(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });

  it('names what was kept when something came across', () => {
    mockTake.mockReturnValue({ ...none, sections: 14, history: 92 });
    captureQuarantineReport();
    const { getByTestId } = render(<LibraryRebuiltNotice />);
    expect(getByTestId('library-rebuilt-notice')).toBeTruthy();
    expect(getByTestId('library-rebuilt-kept').props.children).toContain(
      'engine.quarantine.kept.sections:14'
    );
  });

  it('asks the engine once per open, because the read clears it', () => {
    mockTake.mockReturnValue({ ...none, sections: 1 });
    captureQuarantineReport();
    const { rerender } = render(<LibraryRebuiltNotice />);
    rerender(<LibraryRebuiltNotice />);
    rerender(<LibraryRebuiltNotice />);
    expect(mockTake).toHaveBeenCalledTimes(1);
  });

  it('stays dismissed', () => {
    mockTake.mockReturnValue({ ...none, sections: 1 });
    captureQuarantineReport();
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
    captureQuarantineReport();
    const { queryByTestId } = render(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });

  it('shows a quarantine from an engine opened after the notice mounted', () => {
    const { queryByTestId, getByTestId } = render(<LibraryRebuiltNotice />);
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
    mockTake.mockReturnValueOnce({ ...none, sections: 2 });
    act(() => captureQuarantineReport());
    expect(getByTestId('library-rebuilt-notice')).toBeTruthy();
    expect(mockTake).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when a later engine open has no quarantine', () => {
    const { queryByTestId } = render(<LibraryRebuiltNotice />);
    act(() => captureQuarantineReport());
    expect(queryByTestId('library-rebuilt-notice')).toBeNull();
  });
});
