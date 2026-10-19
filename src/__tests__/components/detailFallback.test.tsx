/**
 * Scenario: a detail read failed, the engine is closed, or the record is missing.
 *
 * Expected behaviour: only a missing record shows the not-found text; a failure shows its
 * engine message with Retry, and Retry calls back. A closed engine that is still opening
 * draws the skeleton, and one that gave up opening says why with a Retry that re-runs the
 * open, rather than shimmering for ever.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { InitOutcome } from 'veloqrs';

import { DetailFallback } from '@/features/routes/components/DetailFallback';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { colors } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockReady = { open: true };
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => mockReady.open,
}));

const mockStackScreen = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: Object.assign(() => null, {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderFallback(
  status: React.ComponentProps<typeof DetailFallback>['status'],
  onRetry = jest.fn(),
  retired?: React.ComponentProps<typeof DetailFallback>['retired']
) {
  return render(
    <DetailFallback
      isDark={false}
      status={status}
      notFoundMessage="not-found"
      onRetry={onRetry}
      retired={retired}
    />
  );
}

beforeEach(() => {
  mockReady.open = true;
  useEngineStatus.setState({ initFailed: false, initFailureReason: null, retryNonce: 0 });
});

describe('DetailFallback', () => {
  it('shows the not-found text for a missing record', async () => {
    const screen = await renderFallback({ kind: 'missing' });
    expect(screen.getByText('not-found')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('shows the engine message and Retry for a failed read, never the not-found text', async () => {
    const onRetry = jest.fn();
    const screen = await renderFallback(
      { kind: 'failed', error: Object.assign(new Error('x'), { tag: 'Database' }) },
      onRetry
    );
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.getByText('engine.failure.database')).toBeTruthy();
    await fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('draws the skeleton for a closed read while the engine is still opening', async () => {
    mockReady.open = false;
    const screen = await renderFallback({ kind: 'closed' });
    expect(screen.getByTestId('detail-fallback-skeleton')).toBeTruthy();
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('stands a route or section card at Peek while the engine is still opening', async () => {
    mockReady.open = false;
    const screen = await render(
      <DetailFallback
        isDark={false}
        status={{ kind: 'closed' }}
        notFoundMessage="not-found"
        onRetry={jest.fn()}
        peek="section"
      />
    );
    expect(screen.getByLabelText('maps.detailLoading.section')).toBeTruthy();
    expect(screen.queryByTestId('detail-fallback-skeleton')).toBeNull();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('says why the engine failed to open, and Retry re-runs the open', async () => {
    mockReady.open = false;
    useEngineStatus.setState({ initFailed: true, initFailureReason: InitOutcome.Failed });
    const onRetry = jest.fn();
    const screen = await renderFallback({ kind: 'closed' }, onRetry);
    expect(screen.queryByTestId('detail-fallback-skeleton')).toBeNull();
    expect(screen.getByText('engine.initReason.failed')).toBeTruthy();

    await fireEvent.press(screen.getByText('common.retry'));
    expect(useEngineStatus.getState().retryNonce).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('offers the update rather than a retry for a database a newer build wrote', async () => {
    mockReady.open = false;
    useEngineStatus.setState({ initFailed: true, initFailureReason: InitOutcome.ForwardSchema });
    const screen = await renderFallback({ kind: 'closed' });
    expect(screen.getByText('engine.initReason.forwardSchema')).toBeTruthy();
    expect(screen.getByText('engine.initAction.update')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('shows the not-open message for a closed read on an engine that is open', async () => {
    const screen = await renderFallback({ kind: 'closed' });
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.getByText('engine.failure.notOpen')).toBeTruthy();
  });

  it('shows how a retired record left and opens the survivor instead of the not-found text', async () => {
    const onOpen = jest.fn();
    const screen = await renderFallback({ kind: 'missing' }, jest.fn(), {
      title: 'merged-title',
      linkLabel: 'into-hill',
      onOpenLink: onOpen,
    });
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.getByText('merged-title')).toBeTruthy();
    await fireEvent.press(screen.getByText('into-hill'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows no link for a retired record with no survivor', async () => {
    const screen = await renderFallback({ kind: 'missing' }, jest.fn(), {
      title: 'dissolved-title',
    });
    expect(screen.getByText('dissolved-title')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('starts the empty state directly under an opaque, themed header, with no spacer', async () => {
    mockStackScreen.mockClear();
    const screen = await renderFallback({ kind: 'missing' });
    const options = (mockStackScreen.mock.calls.at(-1)?.[0] as { options?: object })?.options;
    expect(options).toMatchObject({
      headerTransparent: false,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.textPrimary,
    });
    const root = screen.toJSON() as { children: unknown[] };
    expect(root.children).toHaveLength(1);
  });
});
