/**
 * Scenario: an athlete places the start and end anchors on the activity map and confirms.
 * Expected behaviour: each placed anchor is one medium impact, nothing else in the hook
 * vibrates, and a create that committed is the only thing that fires success.
 */

import { act, renderHook } from '@testing-library/react-native';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { submitSectionCreation } from '@/features/maps/hooks/submitSectionCreation';
import * as haptics from '@/shared/ui/haptics';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const track = [
  { latitude: -33.87, longitude: 151.2 },
  { latitude: -33.871, longitude: 151.201 },
  { latitude: -33.872, longitude: 151.202 },
];

const mockedHaptics = haptics as jest.Mocked<typeof haptics>;

beforeEach(() => jest.clearAllMocks());

function renderCreation(creationMode = true) {
  return renderHook(() =>
    useSectionCreation({
      creationMode,
      externalCreationState: undefined,
      validCoordinates: track,
    })
  );
}

function expectNoHaptic() {
  expect(mockedHaptics.selection).not.toHaveBeenCalled();
  expect(mockedHaptics.light).not.toHaveBeenCalled();
  expect(mockedHaptics.medium).not.toHaveBeenCalled();
  expect(mockedHaptics.success).not.toHaveBeenCalled();
}

describe('useSectionCreation haptics', () => {
  it('fires one medium impact per anchor and none for a tap after complete', () => {
    const { result } = renderCreation();

    act(() => {
      result.current.handleCreationTap(151.2, -33.87);
    });
    expect(mockedHaptics.medium).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleCreationTap(151.202, -33.872);
    });
    expect(mockedHaptics.medium).toHaveBeenCalledTimes(2);
    expect(result.current.creationState).toBe('complete');

    act(() => {
      expect(result.current.handleCreationTap(151.201, -33.871)).toBe(false);
    });
    expect(mockedHaptics.medium).toHaveBeenCalledTimes(2);
    expect(mockedHaptics.success).not.toHaveBeenCalled();
  });

  it('fires the end anchor impact when the end lands before the start', () => {
    const { result } = renderCreation();

    act(() => {
      result.current.handleCreationTap(151.202, -33.872);
    });
    act(() => {
      result.current.handleCreationTap(151.2, -33.87);
    });

    expect(result.current.startIndex).toBe(0);
    expect(mockedHaptics.medium).toHaveBeenCalledTimes(2);
  });

  it('fires nothing for a tap outside creation mode', () => {
    const { result } = renderCreation(false);

    act(() => {
      expect(result.current.handleCreationTap(151.2, -33.87)).toBe(false);
    });

    expectNoHaptic();
  });

  it('fires nothing for a tap with no route coordinates', () => {
    const { result } = renderHook(() =>
      useSectionCreation({
        creationMode: true,
        externalCreationState: undefined,
        validCoordinates: [],
      })
    );

    act(() => {
      expect(result.current.handleCreationTap(151.2, -33.87)).toBe(false);
    });

    expectNoHaptic();
  });

  it('fires nothing on cancel or reset', () => {
    const onCreationCancelled = jest.fn();
    const { result } = renderHook(() =>
      useSectionCreation({
        creationMode: true,
        externalCreationState: undefined,
        validCoordinates: track,
        onCreationCancelled,
      })
    );

    act(() => {
      result.current.handleCreationReset();
    });
    act(() => {
      result.current.handleCreationCancel();
    });

    expect(onCreationCancelled).toHaveBeenCalledTimes(1);
    expectNoHaptic();
  });
});

describe('submitSectionCreation', () => {
  const selected = { polyline: [], startIndex: 2, endIndex: 9, distanceMeters: 800 };
  const activity = { id: 'a1', type: 'Ride' };

  function setup(createSection: jest.Mock) {
    const calls: string[] = [];
    const setters = {
      setMode: jest.fn((on: boolean) => calls.push(`mode:${on}`)),
      setState: jest.fn((state: string | undefined) => calls.push(`state:${state}`)),
      setError: jest.fn((error: unknown) => calls.push(`error:${error === null ? 'null' : 'set'}`)),
    };
    mockedHaptics.success.mockImplementation(() => {
      calls.push('success');
    });
    return { calls, setters, createSection };
  }

  it('fires success once, after the create resolved, and leaves creation mode', async () => {
    const { calls, setters, createSection } = setup(
      jest.fn(async () => {
        calls.push('created');
      })
    );

    await submitSectionCreation({
      result: selected,
      activity,
      createSection,
      translate: (key) => key,
      ...setters,
    });

    expect(createSection).toHaveBeenCalledWith({
      startIndex: 2,
      endIndex: 9,
      sourceActivityId: 'a1',
      sportType: 'Ride',
    });
    expect(mockedHaptics.success).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('created')).toBeLessThan(calls.indexOf('success'));
    expect(setters.setMode).toHaveBeenCalledWith(false);
    expect(setters.setState).toHaveBeenLastCalledWith(undefined);
  });

  it('fires nothing and sets the error state when the create rejects', async () => {
    const failure = Object.assign(new Error('engine said no'), { reason: 'tooFewPoints' });
    const { setters, createSection } = setup(jest.fn().mockRejectedValue(failure));

    await submitSectionCreation({
      result: selected,
      activity,
      createSection,
      translate: (key) => `t:${key}`,
      ...setters,
    });

    expectNoHaptic();
    expect(setters.setMode).not.toHaveBeenCalled();
    expect(setters.setState).toHaveBeenLastCalledWith('error');
    expect(setters.setError).toHaveBeenLastCalledWith({
      message: 't:routes.invalidSectionRange',
      technicalDetails: 'engine said no',
      activityId: 'a1',
      indices: { start: 2, end: 9 },
    });
  });

  it('creates nothing and fires nothing without an activity', async () => {
    const { setters, createSection } = setup(jest.fn());

    await submitSectionCreation({
      result: selected,
      activity: undefined,
      createSection,
      translate: (key) => key,
      ...setters,
    });

    expect(createSection).not.toHaveBeenCalled();
    expectNoHaptic();
  });
});
