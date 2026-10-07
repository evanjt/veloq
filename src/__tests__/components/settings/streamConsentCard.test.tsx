/**
 * Scenario: the engine holds a series download past the large-download
 * threshold and waits for the athlete's answer.
 *
 * Expected behaviour: the feed shows one card stating the engine's activity
 * count and megabytes, Download and Not now call the engine, and an engine
 * with nothing to ask shows no card.
 */

import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

import { StreamConsentCard } from '@/features/settings/components/StreamConsentCard';
import { Card } from '@/shared/ui/Card';
import { useStreamBackfill } from '@/features/settings/hooks/useStreamBackfill';
import { getEngine } from '@/shared/native/engine';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useSyncStatus', () => ({ useSyncState: () => null }));
jest.mock('@/shared/native/routesStatusPoll', () => ({
  readRoutesStatus: jest.fn(),
  followRoutesStatus: jest.fn(() => () => {}),
}));

const { readRoutesStatus } = jest.requireMock('@/shared/native/routesStatusPoll') as {
  readRoutesStatus: jest.Mock;
};

function status(phase: string, extra: Record<string, unknown> = {}) {
  return {
    stream: {
      phase,
      completed: 0,
      total: 0,
      stored: 0,
      failed: 0,
      percent: 0,
      estimateRequests: 0,
      estimateBytes: 0,
      ...extra,
    },
    streamRemaining: 1200,
  };
}

const engine = {
  consentStreamBackfill: jest.fn(),
  stopStreamBackfill: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('StreamConsentCard', () => {
  it('states the engine count and megabytes and answers through the engine', () => {
    readRoutesStatus.mockReturnValue(
      status('awaiting_consent', { estimateRequests: 1200, estimateBytes: 141_000_000 })
    );
    const tree = render(<StreamConsentCard />);

    expect(tree.getByTestId('stream-consent-body').props.children).toBe(
      'feed.streamConsentBody:{"count":1200,"megabytes":141}'
    );
    expect(tree.UNSAFE_getByType(Card).props.variant).toBe('raised');

    fireEvent.press(tree.getByTestId('stream-consent-download'));
    expect(engine.consentStreamBackfill).toHaveBeenCalledTimes(1);

    fireEvent.press(tree.getByTestId('stream-consent-decline'));
    expect(engine.stopStreamBackfill).toHaveBeenCalledTimes(1);
  });

  it('is gone once the answer is given', () => {
    readRoutesStatus.mockReturnValue(status('awaiting_consent', { estimateRequests: 600 }));
    const tree = render(<StreamConsentCard />);

    readRoutesStatus.mockReturnValue(status('stopped'));
    fireEvent.press(tree.getByTestId('stream-consent-decline'));

    expect(tree.queryByTestId('stream-consent-card')).toBeNull();
  });

  it.each(['idle', 'fetching', 'stopped', 'complete'])('shows no card while %s', (phase) => {
    readRoutesStatus.mockReturnValue(status(phase));

    expect(render(<StreamConsentCard />).queryByTestId('stream-consent-card')).toBeNull();
  });

  it('shows no card when the engine cannot answer', () => {
    readRoutesStatus.mockReturnValue(null);

    expect(render(<StreamConsentCard />).queryByTestId('stream-consent-card')).toBeNull();
  });
});

describe('useStreamBackfill consent', () => {
  it('reads the held pass as awaiting the athlete, never as running', () => {
    readRoutesStatus.mockReturnValue(
      status('awaiting_consent', { estimateRequests: 501, estimateBytes: 52_000_000 })
    );
    const { result } = renderHook(() => useStreamBackfill());

    expect(result.current.awaitingConsent).toBe(true);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.estimateRequests).toBe(501);
    expect(result.current.estimateMegabytes).toBe(52);
  });

  it('a Download that starts the pass arms the poll', () => {
    readRoutesStatus.mockReturnValue(status('awaiting_consent', { estimateRequests: 501 }));
    const { result } = renderHook(() => useStreamBackfill());

    act(() => result.current.start());

    expect(engine.consentStreamBackfill).toHaveBeenCalledTimes(1);
  });
});
