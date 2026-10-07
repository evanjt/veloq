/**
 * Scenario: a detail read failed, the engine is closed, or the record is missing.
 *
 * Expected behaviour: only a missing record shows the not-found text; a failure shows its
 * engine message with Retry, and Retry calls back.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DetailFallback } from '@/features/routes/components/DetailFallback';

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
      insetTop={0}
      status={status}
      loading={false}
      notFoundMessage="not-found"
      onRetry={onRetry}
      retired={retired}
    />
  );
}

describe('DetailFallback', () => {
  it('shows the not-found text for a missing record', () => {
    const screen = renderFallback({ kind: 'missing' });
    expect(screen.getByText('not-found')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('shows the engine message and Retry for a failed read, never the not-found text', () => {
    const onRetry = jest.fn();
    const screen = renderFallback(
      { kind: 'failed', error: Object.assign(new Error('x'), { tag: 'Database' }) },
      onRetry
    );
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.getByText('engine.failure.database')).toBeTruthy();
    fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the not-open message for a closed engine that is no longer loading', () => {
    const screen = renderFallback({ kind: 'closed' });
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.getByText('engine.failure.notOpen')).toBeTruthy();
  });

  it('shows how a retired record left and opens the survivor instead of the not-found text', () => {
    const onOpen = jest.fn();
    const screen = renderFallback({ kind: 'missing' }, jest.fn(), {
      title: 'merged-title',
      linkLabel: 'into-hill',
      onOpenLink: onOpen,
    });
    expect(screen.queryByText('not-found')).toBeNull();
    expect(screen.getByText('merged-title')).toBeTruthy();
    fireEvent.press(screen.getByText('into-hill'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows no link for a retired record with no survivor', () => {
    const screen = renderFallback({ kind: 'missing' }, jest.fn(), { title: 'dissolved-title' });
    expect(screen.getByText('dissolved-title')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });
});
