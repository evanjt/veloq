/**
 * Scenario: the two grouping knobs move continuously and each settled value
 * regroups the whole library, which is one blocking engine call.
 *
 * Expected behaviour: a drag across the range starts one run, not one per
 * step; a knob moved mid-run discards the payload being grouped rather than
 * painting it; a run past its budget is cancelled and said so; and leaving the
 * screen cancels what is still grouping.
 */

import { renderHook, act } from '@testing-library/react-native';

import {
  useRouteGroupingPreview,
  GROUPING_DEBOUNCE_MS,
  GROUPING_TIMEOUT_MS,
} from '@/features/routes/hooks/useRouteGroupingPreview';
import type {
  RouteGroupingOutcome,
  RouteGroupingPreviewClient,
} from '../../../modules/veloqrs/src/delegates/routeGroupingPreview';

const GROUPED: RouteGroupingOutcome = {
  state: 'grouped',
  groups: [{ key: 'p1', activityIds: ['a1'] }],
};

/**
 * A client whose run lands when the test says so, which is what the engine's
 * own promise does: the grouping is one call and answers when it is done.
 */
function client(overrides: Partial<RouteGroupingPreviewClient> = {}) {
  // One resolver per run, so a superseded run can answer late and the test
  // says which run answered.
  const settles: ((outcome: RouteGroupingOutcome) => void)[] = [];
  const c = {
    runRouteGroupingPreview: jest.fn(
      () =>
        new Promise<RouteGroupingOutcome>((resolve) => {
          settles.push(resolve);
        })
    ),
    cancelRouteGroupingPreview: jest.fn(),
    finish: (outcome: RouteGroupingOutcome = GROUPED, run = settles.length - 1) =>
      settles[run](outcome),
    ...overrides,
  };
  return c as RouteGroupingPreviewClient & {
    finish: (outcome?: RouteGroupingOutcome, run?: number) => void;
  };
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

  expect(c.runRouteGroupingPreview).toHaveBeenCalledTimes(1);
  expect(c.runRouteGroupingPreview).toHaveBeenCalledWith(65, 250);
});

it('paints the payload the run answered with', async () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });
  expect(result.current.status).toBe('running');

  await act(async () => {
    c.finish();
  });

  expect(result.current.status).toBe('complete');
  expect(result.current.groups).toEqual([{ key: 'p1', activityIds: ['a1'] }]);
});

it('discards the run in flight when the knob moves again', async () => {
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

  // The first run answers late, at the strictness the athlete moved off.
  await act(async () => {
    c.finish({ state: 'grouped', groups: [{ key: 'stale', activityIds: ['a9'] }] }, 0);
  });

  expect(c.cancelRouteGroupingPreview).toHaveBeenCalled();
  expect(c.runRouteGroupingPreview).toHaveBeenLastCalledWith(60, 250);
  expect(result.current.groups).toBeNull();
  expect(result.current.status).toBe('running');
});

it('says so when the engine refuses the run rather than showing an empty map', async () => {
  const c = client({
    runRouteGroupingPreview: jest.fn(() => Promise.resolve({ state: 'refused' as const })),
  });
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  await act(async () => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });

  expect(result.current.refused).toBe(true);
  expect(result.current.status).toBe('idle');
});

it('cancels what is still grouping when the screen goes away', () => {
  const c = client();
  const { result, unmount } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });
  const cancelsAtStart = (c.cancelRouteGroupingPreview as jest.Mock).mock.calls.length;
  unmount();

  expect((c.cancelRouteGroupingPreview as jest.Mock).mock.calls.length).toBeGreaterThan(
    cancelsAtStart
  );
});

it('starts nothing while the value is still moving', () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS - 1);
  });

  expect(c.runRouteGroupingPreview).not.toHaveBeenCalled();
});

/**
 * Expected behaviour: a run that has not answered inside a minute is cancelled
 * and said so. One run is 198 to 442 ms on an S22 over a 585-activity library,
 * so a minute is a hundred runs and the athlete is still on a spinner.
 */
it('gives a wedged run one minute, not two', async () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 60, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });

  await act(async () => {
    await jest.advanceTimersByTimeAsync(59_000);
  });
  expect(result.current.status).toBe('running');
  expect(c.cancelRouteGroupingPreview).toHaveBeenCalledTimes(1); // the start's own clear

  await act(async () => {
    await jest.advanceTimersByTimeAsync(2_000);
  });
  expect(result.current.status).toBe('error');
  expect(c.cancelRouteGroupingPreview).toHaveBeenCalledTimes(2);
});

it('keeps a healthy run going when the process was suspended past the deadline', async () => {
  const c = client();
  const { result } = renderHook(() => useRouteGroupingPreview(c));

  act(() => {
    result.current.request({ minMatchPercentage: 55, endpointThreshold: 250 });
    jest.advanceTimersByTime(GROUPING_DEBOUNCE_MS);
  });
  expect(result.current.status).toBe('running');
  // Every run starts by cancelling whatever the last knob left, so the cancel
  // that matters here is one made after that.
  const cancelsAtStart = (c.cancelRouteGroupingPreview as jest.Mock).mock.calls.length;

  // The suspension: the wall clock moves past the budget with no tick, which
  // is what setSystemTime does and advanceTimersByTime cannot.
  await act(async () => {
    jest.setSystemTime(Date.now() + GROUPING_TIMEOUT_MS + 60_000);
    await jest.advanceTimersByTimeAsync(1_000);
  });

  expect(result.current.status).toBe('running');
  expect((c.cancelRouteGroupingPreview as jest.Mock).mock.calls.length).toBe(cancelsAtStart);

  await act(async () => {
    c.finish();
  });
  expect(result.current.status).toBe('complete');
});
