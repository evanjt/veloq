/**
 * Scenario: a screen, a component or a chart throws on a real device.
 *
 * Expected behaviour: the fallback appears and the crash is written to the
 * on-device log. Only the global boundary recorded, and the other three logged
 * to a console that release strips, so a crash caught below the global
 * boundary left no record at all. The stores surface no crash reports for this
 * app, so that log is the only record there is.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ScreenErrorBoundary } from '@/shared/ui/ScreenErrorBoundary';
import { ComponentErrorBoundary } from '@/shared/ui/ComponentErrorBoundary';
import { ChartErrorBoundary } from '@/shared/ui/ChartErrorBoundary';
import { recordCrash } from '@/shared/debug/crashLog';

// The real `recordBoundaryCrash`, so what is asserted is the shape the
// boundaries actually write, with only the sink itself replaced.
jest.mock('@/shared/debug/crashLog', () => ({
  ...jest.requireActual('@/shared/debug/crashLog'),
  recordCrash: jest.fn(),
}));

jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const mockRecord = recordCrash as jest.MockedFunction<typeof recordCrash>;

function Boom(): React.ReactElement {
  throw new Error('the chart could not draw');
}

/** React logs a caught error itself; the boundary is what is under test. */
let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

describe('an error caught below the global boundary is recorded', () => {
  it('records a screen crash, and says which screen', () => {
    render(
      <ScreenErrorBoundary screenName="Routes">
        <Boom />
      </ScreenErrorBoundary>
    );

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'react-boundary',
        message: 'the chart could not draw',
        fatal: false,
        screen: 'Routes',
      })
    );
  });

  it('records a component crash under its component name', () => {
    render(
      <ComponentErrorBoundary componentName="SectionList">
        <Boom />
      </ComponentErrorBoundary>
    );

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fatal: false, screen: 'SectionList' })
    );
  });

  it('records a chart crash under its label', () => {
    render(
      <ChartErrorBoundary label="Power curve">
        <Boom />
      </ChartErrorBoundary>
    );

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fatal: false, screen: 'Power curve' })
    );
  });

  /** None of the three is fatal: the app is still running behind the fallback. */
  it('marks none of them fatal', () => {
    render(
      <ChartErrorBoundary>
        <Boom />
      </ChartErrorBoundary>
    );

    expect(mockRecord.mock.calls[0][0].fatal).toBe(false);
  });

  /** An unnamed boundary still records, under whatever screen the log knows. */
  it('records without a name rather than not recording', () => {
    render(
      <ComponentErrorBoundary>
        <Boom />
      </ComponentErrorBoundary>
    );

    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0].screen).toBeUndefined();
  });

  it('carries a stack so the record is worth reading', () => {
    render(
      <ScreenErrorBoundary screenName="Routes">
        <Boom />
      </ScreenErrorBoundary>
    );

    expect(mockRecord.mock.calls[0][0].stack).toEqual(expect.stringContaining('Error'));
  });

  it('still calls the caller-supplied handler', () => {
    const onError = jest.fn();
    render(
      <ComponentErrorBoundary componentName="SectionList" onError={onError}>
        <Boom />
      </ComponentErrorBoundary>
    );

    expect(onError).toHaveBeenCalled();
  });
});
