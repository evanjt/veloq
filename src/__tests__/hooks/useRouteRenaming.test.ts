/**
 * Scenario: renaming a route checks the new name is not already taken.
 * Expected behaviour: the check reads the engine's name map, the same source
 * the hook seeds its current name from, and reuses a pre-computed map when
 * the screen already read one.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useRouteRenaming } from '@/features/routes/hooks/useRouteRenaming';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({ getRouteEngine: jest.fn() }));

const getAllRouteNames = jest.fn();
const getGroupSummaries = jest.fn();
const setRouteName = jest.fn();

const t = ((key: string) => key) as never;

beforeEach(() => {
  jest.clearAllMocks();
  getAllRouteNames.mockReturnValue({});
  getGroupSummaries.mockImplementation(() => {
    throw new Error('the rename path must not read group summaries');
  });
  (getRouteEngine as jest.Mock).mockReturnValue({
    getAllRouteNames,
    getGroupSummaries,
    setRouteName,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

function rename(hook: ReturnType<typeof renderHook>, name: string) {
  const api = hook.result.current as ReturnType<typeof useRouteRenaming>;
  act(() => api.setEditName(name));
  act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());
}

it('saves a name no other route holds', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'Old', 'route-2': 'River Loop' });

  const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
  rename(hook, 'Hill Climb');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'Hill Climb');
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('rejects a name another route already holds', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'Old', 'route-2': 'River Loop' });

  const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
  rename(hook, 'River Loop');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalled();
});

it('accepts the route keeping its own name', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'River Loop' });

  const hook = renderHook(() => useRouteRenaming('route-1', 'River Loop', t));
  rename(hook, 'River Loop');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'River Loop');
});

it('checks against the pre-computed map rather than calling the engine again', () => {
  const hook = renderHook(() =>
    useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old', 'route-2': 'River Loop' })
  );
  getAllRouteNames.mockClear();
  rename(hook, 'River Loop');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalled();
  expect(getAllRouteNames).not.toHaveBeenCalled();
});

it('does nothing when the name is only whitespace', () => {
  const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
  rename(hook, '   ');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('saves when there is no engine name map at all', () => {
  const hook = renderHook(() => useRouteRenaming('route-1', undefined, t));
  rename(hook, 'First');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'First');
});
