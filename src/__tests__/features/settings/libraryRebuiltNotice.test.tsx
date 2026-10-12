/**
 * Scenario: the launch after a quarantine. `takeQuarantineReport` answers once
 * and clears itself, so anything that reads it twice loses the message.
 *
 * Expected behaviour: each engine open reads it once, the platform alert shows
 * for every quarantine, naming what was kept when anything was, and dismisses
 * for good.
 */

import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { LibraryRebuiltNotice } from '@/features/settings/components/LibraryRebuiltNotice';
import {
  captureQuarantineReport,
  clearQuarantineReport,
} from '@/features/settings/lib/quarantineReport';
import { useEngineStatus } from '@/features/routes';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

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

const none = {
  history: 0,
  geometry: 0,
  pins: 0,
  sections: 0,
  intents: 0,
  recordings: 0,
  routeNames: 0,
};

let alertSpy: jest.SpyInstance;

function lastAlert() {
  const [title, body, buttons, options] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1] as [
    string,
    string,
    AlertButton[],
    { cancelable?: boolean; onDismiss?: () => void },
  ];
  return { title, body, buttons, options };
}

beforeEach(() => {
  mockTake.mockReset().mockReturnValue(null);
  clearQuarantineReport();
  // A launch past the first, so the notice is the one modal the launch raises.
  useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: '0.0.1', tourState: null });
  useWhatsNewStore.setState({ launchModal: null, restoreOffered: false });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => alertSpy.mockRestore());

describe('LibraryRebuiltNotice', () => {
  it('shows nothing when this launch opened the file it was given', async () => {
    await render(<LibraryRebuiltNotice />);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('says the library was rebuilt when the rebuild rescued nothing', async () => {
    mockTake.mockReturnValue(none);
    captureQuarantineReport();
    await render(<LibraryRebuiltNotice />);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const { title, body, buttons } = lastAlert();
    expect(title).toBe('engine.quarantine.title');
    expect(body).toBe('engine.quarantine.keptNothing\nengine.quarantine.resyncing');
    expect(buttons.map((b) => b.text)).toEqual(['engine.quarantine.dismiss']);
  });

  it('names what was kept when something came across', async () => {
    mockTake.mockReturnValue({ ...none, sections: 14, history: 92 });
    captureQuarantineReport();
    await render(<LibraryRebuiltNotice />);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(lastAlert().body).toContain('engine.quarantine.kept.sections:14');
    expect(lastAlert().body).toContain('engine.quarantine.resyncing');
    expect(lastAlert().body).not.toContain('engine.quarantine.keptNothing');
  });

  it('speaks once however often it rerenders, and the engine is asked once per open', async () => {
    mockTake.mockReturnValue({ ...none, sections: 1 });
    captureQuarantineReport();
    const { rerender } = await render(<LibraryRebuiltNotice />);
    await rerender(<LibraryRebuiltNotice />);
    await rerender(<LibraryRebuiltNotice />);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockTake).toHaveBeenCalledTimes(1);
  });

  it('clears the report from the button and from an Android dismiss', async () => {
    mockTake.mockReturnValue({ ...none, sections: 1 });
    captureQuarantineReport();
    const { rerender } = await render(<LibraryRebuiltNotice />);
    expect(lastAlert().options.cancelable).toBe(true);

    await act(() => lastAlert().buttons[0].onPress?.());
    expect(useEngineStatus.getState().quarantineReport).toBeNull();
    await rerender(<LibraryRebuiltNotice />);
    expect(alertSpy).toHaveBeenCalledTimes(1);

    mockTake.mockReturnValueOnce({ ...none, sections: 2 });
    await act(() => captureQuarantineReport());
    expect(alertSpy).toHaveBeenCalledTimes(2);
    await act(() => lastAlert().options.onDismiss?.());
    expect(useEngineStatus.getState().quarantineReport).toBeNull();
  });

  it('survives an engine that is not there', async () => {
    mockTake.mockImplementation(() => {
      throw new Error('not initialised');
    });
    captureQuarantineReport();
    await render(<LibraryRebuiltNotice />);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows a quarantine from an engine opened after the notice mounted', async () => {
    await render(<LibraryRebuiltNotice />);
    expect(alertSpy).not.toHaveBeenCalled();
    mockTake.mockReturnValueOnce({ ...none, sections: 2 });
    await act(() => captureQuarantineReport());
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockTake).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when a later engine open has no quarantine', async () => {
    await render(<LibraryRebuiltNotice />);
    await act(() => captureQuarantineReport());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
