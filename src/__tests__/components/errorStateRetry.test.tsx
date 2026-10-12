/**
 * A failed read names its cause and offers a recovery in place, through one
 * shared state with one retry label and one button.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/shared/ui/Button';
import { ChartErrorBoundary } from '@/shared/ui/ChartErrorBoundary';
import { ErrorState } from '@/shared/ui/ErrorState';

jest.mock('@/shared/ui/Button', () => {
  const actual = jest.requireActual('@/shared/ui/Button');
  return { ...actual, Button: jest.fn(actual.Button) };
});
jest.mock('@/shared/debug/crashLog', () => ({
  ...jest.requireActual('@/shared/debug/crashLog'),
  recordCrash: jest.fn(),
}));
jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockButton = Button as jest.MockedFunction<typeof Button>;
const busy = { tag: 'Busy', message: 'a job is running' };

function Boom(): React.ReactElement {
  throw new Error('the chart could not draw');
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

function lastButtonProps() {
  return mockButton.mock.calls.at(-1)?.[0];
}

describe('ErrorState', () => {
  it('names the engine reason inline and retries through the shared secondary button', async () => {
    const onRetry = jest.fn();
    await render(
      <ErrorState variant="inline" error={busy} onRetry={onRetry} testID="card-failure" />
    );

    expect(screen.getByText('engine.failure.busy')).toBeTruthy();
    expect(lastButtonProps()).toEqual(
      expect.objectContaining({ label: 'common.retry', variant: 'secondary', size: 'sm' })
    );

    await fireEvent.press(screen.getByTestId('card-failure-retry'));
    await fireEvent.press(screen.getByTestId('card-failure-retry'));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('stands in for a screen with the primary button and the caller fallback for a failure not the engine', async () => {
    const onRetry = jest.fn();
    await render(
      <ErrorState
        error={new TypeError('Network request failed')}
        fallbackKey="feed.failedToLoad"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('emptyState.error.title')).toBeTruthy();
    expect(screen.getByText('feed.failedToLoad')).toBeTruthy();
    expect(screen.queryByText('Network request failed')).toBeNull();
    expect(lastButtonProps()).toEqual(
      expect.objectContaining({ label: 'common.retry', variant: 'primary' })
    );
    await fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('reads a missing error as the generic line rather than as nothing', async () => {
    await render(<ErrorState error={undefined} onRetry={jest.fn()} />);
    expect(screen.getByText('emptyState.error.description')).toBeTruthy();
  });
});

describe('ChartErrorBoundary', () => {
  it('offers the shared Retry button, and the retry draws the chart again', async () => {
    let fail = true;
    function Chart(): React.ReactElement {
      if (fail) return <Boom />;
      const { Text } = require('react-native');
      return <Text>drawn</Text>;
    }
    await render(
      <ChartErrorBoundary chartName="Power curve">
        <Chart />
      </ChartErrorBoundary>
    );

    expect(screen.getByText('errorState.unableToDisplayChart')).toBeTruthy();
    expect(screen.queryByText('errorState.tapToRetry')).toBeNull();
    expect(lastButtonProps()).toEqual(
      expect.objectContaining({ label: 'common.retry', variant: 'secondary', size: 'sm' })
    );

    fail = false;
    await fireEvent.press(screen.getByText('common.retry'));
    expect(screen.getByText('drawn')).toBeTruthy();
  });
});
