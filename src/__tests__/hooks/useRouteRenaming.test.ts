/**
 * Scenario: renaming a route checks the new name is not already taken.
 * Expected behaviour: the check reads the name map the route detail read
 * carries, the same source the hook seeds its current name from.
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

const getGroupSummaries = jest.fn();
const setRouteName = jest.fn();

const t = ((key: string) => key) as never;

beforeEach(() => {
  jest.clearAllMocks();
  setRouteName.mockReset();
  getGroupSummaries.mockImplementation(() => {
    throw new Error('the rename path must not read group summaries');
  });
  (getEngine as jest.Mock).mockReturnValue({
    getGroupSummaries,
    setRouteName,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

async function rename(hook: Awaited<ReturnType<typeof renderHook>>, name: string) {
  const api = hook.result.current as ReturnType<typeof useRouteRenaming>;
  await act(() => api.setEditName(name));
  await act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());
}

it('saves a name no other route holds', async () => {
  const hook = await renderHook(() =>
    useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old', 'route-2': 'River Loop' })
  );
  await rename(hook, 'Hill Climb');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'Hill Climb');
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('restores the shown name and alerts when the engine refuses a rename', async () => {
  setRouteName.mockImplementation(() => {
    throw new Error('Storage unavailable');
  });

  const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old' }));
  await rename(hook, 'Hill Climb');

  expect(hook.result.current.customName).toBe('Old');
  expect(Alert.alert).toHaveBeenCalledWith(
    'routes.renameFailedTitle',
    'routes.renameFailedMessage',
    undefined,
    expect.objectContaining({ cancelable: true })
  );
  expect(haptics.success).not.toHaveBeenCalled();
});

it('rejects a name another route already holds', async () => {
  const hook = await renderHook(() =>
    useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old', 'route-2': 'River Loop' })
  );
  await rename(hook, 'River Loop');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalled();
});

it('writes nothing when the field is saved unchanged', async () => {
  const hook = await renderHook(() =>
    useRouteRenaming('route-1', 'Route 3', t, { 'route-1': 'Route 3' })
  );
  await act(() =>
    (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing()
  );
  await act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('writes when the field is edited away from the name it opened with', async () => {
  const hook = await renderHook(() =>
    useRouteRenaming('route-1', 'Route 3', t, { 'route-1': 'Route 3' })
  );
  await act(() =>
    (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing()
  );
  await rename(hook, 'River Loop');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'River Loop');
});

it('seeds the shown name once the detail read arrives', async () => {
  const hook = await renderHook(
    ({ names }: { names: Record<string, string> | undefined }) =>
      useRouteRenaming('route-1', 'Route 3', t, names),
    { initialProps: { names: undefined as Record<string, string> | undefined } }
  );
  expect(hook.result.current.customName).toBeNull();

  await hook.rerender({ names: { 'route-1': 'River Loop', 'route-2': 'Hill Climb' } });
  expect(hook.result.current.customName).toBe('River Loop');

  await act(() => hook.result.current.setEditName('Hill Climb'));
  await act(() => hook.result.current.handleSaveName());
  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalled();
});

it('does nothing when the name is only whitespace', async () => {
  const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t, {}));
  await rename(hook, '   ');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('saves when the name map is empty', async () => {
  const hook = await renderHook(() => useRouteRenaming('route-1', undefined, t, {}));
  await rename(hook, 'First');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'First');
});

describe('route rename haptics', () => {
  it('fires one success when a new name is saved', async () => {
    const hook = await renderHook(() =>
      useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old' })
    );
    await rename(hook, 'Hill Climb');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('fires nothing for a blank name', async () => {
    const hook = await renderHook(() =>
      useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old' })
    );
    await rename(hook, '   ');
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires nothing for an unchanged name', async () => {
    const hook = await renderHook(() =>
      useRouteRenaming('route-1', 'Route 3', t, { 'route-1': 'Route 3' })
    );
    await act(() =>
      (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing()
    );
    await act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires nothing for a duplicate name', async () => {
    const hook = await renderHook(() =>
      useRouteRenaming('route-1', 'Old', t, { 'route-1': 'Old', 'route-2': 'River Loop' })
    );
    await rename(hook, 'River Loop');
    expect(haptics.success).not.toHaveBeenCalled();
  });
});
