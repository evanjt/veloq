/**
 * Scenario: renaming a route checks the new name is not already taken.
 * Expected behaviour: the check reads the engine's name map, the same source
 * the hook seeds its current name from, and reuses a pre-computed map when
 * the screen already read one.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useRouteRenaming } from '@/features/routes/hooks/useRouteRenaming';
import * as haptics from '@/shared/ui/haptics';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const getAllRouteNames = jest.fn();
const getGroupSummaries = jest.fn();
const setRouteName = jest.fn();

const t = ((key: string) => key) as never;

beforeEach(() => {
  jest.clearAllMocks();
  setRouteName.mockReset();
  getAllRouteNames.mockReturnValue({});
  getGroupSummaries.mockImplementation(() => {
    throw new Error('the rename path must not read group summaries');
  });
  (getEngine as jest.Mock).mockReturnValue({
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

it('restores the shown name and alerts when the engine refuses a rename', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'Old' });
  setRouteName.mockImplementation(() => {
    throw new Error('Storage unavailable');
  });

  const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
  rename(hook, 'Hill Climb');

  expect(hook.result.current.customName).toBe('Old');
  expect(Alert.alert).toHaveBeenCalledWith(
    'routes.renameFailedTitle',
    'routes.renameFailedMessage'
  );
  expect(haptics.success).not.toHaveBeenCalled();
});

it('rejects a name another route already holds', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'Old', 'route-2': 'River Loop' });

  const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
  rename(hook, 'River Loop');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalled();
});

it('writes nothing when the field is saved unchanged', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'Route 3' });

  const hook = renderHook(() => useRouteRenaming('route-1', 'Route 3', t));
  act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing());
  act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('writes when the field is edited away from the name it opened with', () => {
  getAllRouteNames.mockReturnValue({ 'route-1': 'Route 3' });

  const hook = renderHook(() => useRouteRenaming('route-1', 'Route 3', t));
  act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing());
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

describe('route rename haptics', () => {
  it('fires one success when a new name is saved', () => {
    getAllRouteNames.mockReturnValue({ 'route-1': 'Old' });
    const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
    rename(hook, 'Hill Climb');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('fires nothing for a blank name', () => {
    getAllRouteNames.mockReturnValue({ 'route-1': 'Old' });
    const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
    rename(hook, '   ');
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires nothing for an unchanged name', () => {
    getAllRouteNames.mockReturnValue({ 'route-1': 'Route 3' });
    const hook = renderHook(() => useRouteRenaming('route-1', 'Route 3', t));
    act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing());
    act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires nothing for a duplicate name', () => {
    getAllRouteNames.mockReturnValue({ 'route-1': 'Old', 'route-2': 'River Loop' });
    const hook = renderHook(() => useRouteRenaming('route-1', 'Old', t));
    rename(hook, 'River Loop');
    expect(haptics.success).not.toHaveBeenCalled();
  });
});
