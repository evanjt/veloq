/**
 * Scenario: an athlete taps two anchors on a track that retraces its own ground, so each tap
 * sits within GPS noise of both the outbound and the return pass.
 * Expected behaviour: the start snaps to the nearest vertex, and the end snaps to whichever
 * pass keeps the section shortest, so the section never runs over the turnaround and back.
 */

import { act, renderHook } from '@testing-library/react-native';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const ORIGIN_LAT = -33.87;
const ORIGIN_LNG = 151.2;
const METRES_PER_DEG_LAT = 111_195;
const METRES_PER_DEG_LNG = METRES_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);
const LEG_VERTICES = 100;
const SPACING_M = 10;

function at(northM: number, eastM: number) {
  return {
    latitude: ORIGIN_LAT + northM / METRES_PER_DEG_LAT,
    longitude: ORIGIN_LNG + eastM / METRES_PER_DEG_LNG,
  };
}

const outbound = Array.from({ length: LEG_VERTICES }, (_, i) => at(i * SPACING_M, 0));
const returnLeg = Array.from({ length: LEG_VERTICES }, (_, j) =>
  at((LEG_VERTICES - 1 - j) * SPACING_M, 1)
);
const outAndBack = [...outbound, ...returnLeg];

function returnIndexBeside(outboundIndex: number) {
  return LEG_VERTICES + (LEG_VERTICES - 1 - outboundIndex);
}

function renderCreation(track: { latitude: number; longitude: number }[]) {
  return renderHook(() =>
    useSectionCreation({
      creationMode: true,
      externalCreationState: undefined,
      validCoordinates: track,
    })
  );
}

function tap(
  result: { current: ReturnType<typeof useSectionCreation> },
  point: { latitude: number; longitude: number }
) {
  act(() => {
    result.current.handleCreationTap(point.longitude, point.latitude);
  });
}

describe('useSectionCreation snap on a retraced track', () => {
  it('keeps the end on the outbound pass when the tap sits nearer the return pass', () => {
    const { result } = renderCreation(outAndBack);

    tap(result, at(20 * SPACING_M, 0));
    tap(result, at(40 * SPACING_M, 0.6));

    expect(result.current.startIndex).toBe(20);
    expect(result.current.endIndex).toBe(40);
    expect(result.current.sectionDistance).toBeCloseTo(200, 0);
  });

  it('keeps the section on the return pass when the start is tapped there', () => {
    const { result } = renderCreation(outAndBack);

    tap(result, at(60 * SPACING_M, 0.6));
    expect(result.current.startIndex).toBe(returnIndexBeside(60));

    tap(result, at(80 * SPACING_M, 0.4));

    expect(result.current.startIndex).toBe(returnIndexBeside(80));
    expect(result.current.endIndex).toBe(returnIndexBeside(60));
    expect(result.current.sectionDistance).toBeCloseTo(200, 0);
  });

  it('still swaps when the end is tapped before the start on the same pass', () => {
    const { result } = renderCreation(outAndBack);

    tap(result, at(50 * SPACING_M, 0));
    tap(result, at(30 * SPACING_M, 0.6));

    expect(result.current.startIndex).toBe(30);
    expect(result.current.endIndex).toBe(50);
  });

  it('snaps to the nearest vertex on a track that never retraces', () => {
    const { result } = renderCreation(outbound);

    tap(result, at(60 * SPACING_M + 3, 4));
    tap(result, at(30 * SPACING_M - 2, -5));

    expect(result.current.startIndex).toBe(30);
    expect(result.current.endIndex).toBe(60);
    expect(result.current.sectionDistance).toBeCloseTo(300, 0);
  });

  it('takes the nearest pass for the end when the other pass is beyond the tolerance', () => {
    const farReturn = Array.from({ length: LEG_VERTICES }, (_, j) =>
      at((LEG_VERTICES - 1 - j) * SPACING_M, 200)
    );
    const { result } = renderCreation([...outbound, ...farReturn]);

    tap(result, at(20 * SPACING_M, 0));
    tap(result, at(40 * SPACING_M, 199));

    expect(result.current.startIndex).toBe(20);
    expect(result.current.endIndex).toBe(returnIndexBeside(40));
  });
});
