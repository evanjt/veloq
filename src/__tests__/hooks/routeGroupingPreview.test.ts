/**
 * Scenario: the two grouping knobs move continuously and each settled value
 * regroups the whole library, which is one blocking engine call.
 *
 * Expected behaviour: a drag across the range starts one run, not one per
 * step; a knob moved mid-run discards the payload being grouped rather than
 * painting it; and leaving the screen releases the slot.
 */

import { renderHook, act } from '@testing-library/react-native';

import {
  useRouteGroupingPreview,
  GROUPING_DEBOUNCE_MS,
  GROUPING_POLL_INTERVAL_MS,
} from '@/features/routes/hooks/useRouteGroupingPreview';
import type {
  RouteGroupingPollStatus,
  RouteGroupingPreviewClient,
} from '../../../modules/veloqrs/src/delegates/routeGroupingPreview';

function client(overrides: Partial<RouteGroupingPreviewClient> = {}) {
  let status: RouteGroupingPollStatus = 'idle';
  const c = {
    startRouteGroupingPreview: jest.fn(() => {
      status = 'running';
      return true;
    }),
    pollRouteGroupingPreview: jest.fn(() => status),
    takeRouteGroupingPreviewResult: jest.fn(() => [{ key: 'p1', activityIds: ['a1'] }]),
    cancelRouteGroupingPreview: jest.fn(),
    finish: () => {
      status = 'complete';
    },
    ...overrides,
  };
  return c as RouteGroupingPreviewClient & { finish: () => void };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('starts one run for a drag across the range, at the value it settled on', () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    for (let pct = 50; pct <= 65; pct++) {
      result.current.request({ minMatchPercentage: pct, endpointThreshold: 250 });
      jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS - 50);
    }
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });

  expect(c.startRouteGroupingPreview).toHaveBeenCalledTimes(1);
  expect(c.startRouteGroupingPreview).toHaveBeenCalledWith(65, 250);
});

it('takes the payload once the run finishes, and stops polling', () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });
  expect(result.current.status).toBe('running');

  act(() => {
    c.finish();
    jest.advanceTimersByTime(GROUPING_POLL_INTERVAL_MS);
  });

  expect(result.current.status).toBe('complete');
  expect(result.current.groups).toEqual([{ key: 'p1', activityIds: ['a1'] }]);

  const pollsAtComplete = (c.pollRouteGroupingPreview as jest.Mock).mock.calls.length;
  act(() => jest.advanceTimersByTime(GROUPING_POLL_INTERVAL_MS * 4));
  expect((c.pollRouteGroupingPreview as jest.Mock).mock.calls.length).toBe(pollsAtComplete);
});

it('discards the run in flight when the knob moves again', () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });
  act(() => {
    result.current.request({ minMatchPercentage: 60, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });

  expect(c.cancelRouteGroupingPreview).toHaveBeenCalled();
  expect(c.startRouteGroupingPreview).toHaveBeenLastCalledWith(60, 250);
});

it('says so when the engine refuses the run rather than showing an empty map', () => {
  const c = client({ startRouteGroupingPreview: jest.fn(() => false) });
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });

  expect(result.current.refused).toBe(true);
  expect(result.current.status).toBe('idle');
});

it('releases the slot when the screen goes away mid-run', () => {
  const c = client();
  const { result, unmount } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });
  unmount();

  expect(c.cancelRouteGroupingPreview).toHaveBeenCalled();
  const pollsAtUnmount = (c.pollRouteGroupingPreview as jest.Mock).mock.calls.length;
  act(() => jest.advanceTimersByTime(GROUPING_POLL_INTERVAL_MS * 4));
  expect((c.pollRouteGroupingPreview as jest.Mock).mock.calls.length).toBe(pollsAtUnmount);
});

it('starts nothing while the value is still moving', () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS - 1);
  });

  expect(c.startRouteGroupingPreview).not.toHaveBeenCalled();
});
