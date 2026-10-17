/**
 * Scenario: renaming a route to a name another route is shown under.
 * Expected behaviour: the engine refuses it, and the hook puts the shown name
 * back and tells the athlete the name is taken. The hook seeds its name from
 * the route's own shown name and reads no other route's.
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

/** The refusal the engine raises for a name another route is shown under. */
function nameTaken(name: string): Error {
  return new Error(`RouteNameTaken: Another route is already named ${name}`);
}

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
  const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
  await rename(hook, 'Hill Climb');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'Hill Climb');
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('restores the shown name and alerts when the engine refuses a rename', async () => {
  setRouteName.mockImplementation(() => {
    throw new Error('Storage unavailable');
  });

  const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
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

it('restores the shown name and says so when the engine finds the name taken', async () => {
  setRouteName.mockImplementation((_id: string, name: string) => {
    throw nameTaken(name);
  });
  const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
  await rename(hook, 'River Loop');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'River Loop');
  expect(hook.result.current.customName).toBe('Old');
  expect(Alert.alert).toHaveBeenCalledWith(
    'routes.duplicateNameTitle',
    'routes.duplicateNameMessage',
    undefined,
    expect.objectContaining({ cancelable: true })
  );
  expect(haptics.success).not.toHaveBeenCalled();
});

it('writes nothing when the field is saved unchanged', async () => {
  const hook = await renderHook(() => useRouteRenaming('route-1', 'Route 3', t));
  await act(() =>
    (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing()
  );
  await act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('writes when the field is edited away from the name it opened with', async () => {
  const hook = await renderHook(() => useRouteRenaming('route-1', 'Route 3', t));
  await act(() =>
    (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing()
  );
  await rename(hook, 'River Loop');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'River Loop');
});

it('seeds the shown name once the detail read arrives', async () => {
  const hook = await renderHook(
    ({ shown }: { shown: string | undefined }) => useRouteRenaming('route-1', shown, t),
    { initialProps: { shown: undefined as string | undefined } }
  );
  expect(hook.result.current.customName).toBeNull();

  await hook.rerender({ shown: 'River Loop' });
  expect(hook.result.current.customName).toBe('River Loop');

  await act(() => hook.result.current.handleStartEditing());
  await act(() => hook.result.current.handleSaveName());
  expect(setRouteName).not.toHaveBeenCalled();
});

it('does nothing when the name is only whitespace', async () => {
  const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
  await rename(hook, '   ');

  expect(setRouteName).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('saves when the route has no shown name yet', async () => {
  const hook = await renderHook(() => useRouteRenaming('route-1', undefined, t));
  await rename(hook, 'First');

  expect(setRouteName).toHaveBeenCalledWith('route-1', 'First');
});

describe('route rename haptics', () => {
  it('fires one success when a new name is saved', async () => {
    const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
    await rename(hook, 'Hill Climb');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('fires nothing for a blank name', async () => {
    const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
    await rename(hook, '   ');
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires nothing for an unchanged name', async () => {
    const hook = await renderHook(() => useRouteRenaming('route-1', 'Route 3', t));
    await act(() =>
      (hook.result.current as ReturnType<typeof useRouteRenaming>).handleStartEditing()
    );
    await act(() => (hook.result.current as ReturnType<typeof useRouteRenaming>).handleSaveName());
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires nothing for a duplicate name', async () => {
    setRouteName.mockImplementation((_id: string, name: string) => {
      throw nameTaken(name);
    });
    const hook = await renderHook(() => useRouteRenaming('route-1', 'Old', t));
    await rename(hook, 'River Loop');
    expect(haptics.success).not.toHaveBeenCalled();
  });
});
