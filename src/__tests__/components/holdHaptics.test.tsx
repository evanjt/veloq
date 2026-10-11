/**
 * Scenario: a hold that the app recognises opens something under the finger: the
 * strength loupe, a chart's axis preview, the field picker on a ride tile, the
 * section scrub. Each is a long-press activation.
 *
 * Expected behaviour: each recognised hold fires exactly one light impact and no
 * other class, and a plain tap fires none.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import type { SectionEncounter } from 'veloqrs';

import * as haptics from '@/shared/ui/haptics';
import { BodyPairWithLoupe } from '@/features/strength/components/BodyPairWithLoupe';
import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { ActivitySectionsSection } from '@/features/activity/components/ActivitySectionsSection';
import type { ChartConfig } from '@/features/activity/lib/chartConfig';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
  onPullRefresh: (handler: unknown) => handler,
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('react-native-body-highlighter', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('react-native-body-highlighter'),
    __esModule: true,
    default: () => <View />,
  };
});

const mockSectionInlinePlot = jest.fn((_props: unknown) => null);
jest.mock('@/features/activity/components/SectionInlinePlot', () => ({
  SectionInlinePlot: (props: unknown) => mockSectionInlinePlot(props),
}));
jest.mock('@/features/routes', () => ({ DataRangeFooter: () => null }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => ({}) }));

type Handlers = { onStart: (e: { x: number; y: number; absoluteY: number }) => void };

/** The gestures of one kind the component builds, newest last. */
function capture(kind: 'LongPress' | 'Pan'): unknown[] {
  const built: unknown[] = [];
  const real = Gesture[kind].bind(Gesture) as () => unknown;
  jest.spyOn(Gesture, kind).mockImplementation((() => {
    const gesture = real();
    built.push(gesture);
    return gesture;
  }) as never);
  return built;
}

const startOf = (built: unknown[]) =>
  (built[built.length - 1] as { handlers: Handlers }).handlers.onStart;

/** A worklet reaches JS through `runOnJS`, which schedules rather than calls. */
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fired() {
  return {
    selection: (haptics.selection as jest.Mock).mock.calls.length,
    light: (haptics.light as jest.Mock).mock.calls.length,
    medium: (haptics.medium as jest.Mock).mock.calls.length,
    success: (haptics.success as jest.Mock).mock.calls.length,
  };
}

const ONE_LIGHT = { selection: 0, light: 1, medium: 0, success: 0 };
const NONE = { selection: 0, light: 0, medium: 0, success: 0 };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('the strength loupe fires one light impact when its hold is recognised', async () => {
  const presses = capture('LongPress');
  render(
    <BodyPairWithLoupe
      data={[]}
      gender="male"
      maxScale={0.8}
      colors={['#111111']}
      onMuscleScrub={() => {}}
      tappableSlugs={new Set(['chest'])}
    />
  );

  await settle(() => startOf(presses)({ x: 10, y: 10, absoluteY: 10 }));

  expect(fired()).toEqual(ONE_LIGHT);
});

describe('the chart type chips', () => {
  const available = [
    { id: 'heartrate', label: 'HR', icon: 'heart', color: '#ff0000', ink: '#ffffff' },
  ] as unknown as ChartConfig[];

  function chips() {
    const onToggle = jest.fn();
    const onPreviewStart = jest.fn();
    const tree = render(
      <ChartTypeSelector
        available={available}
        selected={['heartrate']}
        onToggle={onToggle}
        onPreviewStart={onPreviewStart}
        onPreviewEnd={jest.fn()}
      />
    );
    const chip = tree.getByTestId('chart-type-heartrate');
    return { chip, onToggle, onPreviewStart };
  }

  it('fire one light impact when a hold opens the axis preview', () => {
    const { chip, onPreviewStart } = chips();

    fireEvent(chip, 'pressIn');
    fireEvent(chip, 'longPress');

    expect(onPreviewStart).toHaveBeenCalledWith('heartrate');
    expect(fired()).toEqual(ONE_LIGHT);
  });

  it('fire nothing of their own on a tap', () => {
    const { chip, onToggle } = chips();

    fireEvent.press(chip);

    expect(onToggle).toHaveBeenCalledWith('heartrate');
    expect(fired()).toEqual(NONE);
  });
});

it('a ride tile fires one light impact when its hold opens the field picker', () => {
  const onLongPressField = jest.fn();
  const tree = render(
    <DataFieldGrid
      fields={['speed', 'distance']}
      metrics={{
        speed: 5,
        avgSpeed: 5,
        distance: 1000,
        heartrate: 0,
        power: 0,
        cadence: 0,
        elevation: 450,
        elevationGain: 20,
        calories: 10,
        lapDistance: 1000,
        lapTime: 200,
        elapsedTime: 200,
        movingTime: 200,
      }}
      isMetric
      onLongPressField={onLongPressField}
    />
  );

  fireEvent(tree.getByTestId('data-field-speed'), 'longPress');

  expect(onLongPressField).toHaveBeenCalledWith(0, 'speed');
  expect(fired()).toEqual(ONE_LIGHT);
});

it('the sections scrub fires one light impact when it lands on a row', async () => {
  const pans = capture('Pan');
  const onHighlight = jest.fn();
  render(
    <ActivitySectionsSection
      activityId="a1"
      sportType="Ride"
      encounters={[
        {
          sectionId: 'loop-1',
          sectionType: 'auto',
          sectionName: 'Quarry loop',
          direction: 'same',
          distanceMeters: 1200,
          startIndex: 0,
          lapTime: 140,
          lapPace: 2.3,
          isPr: false,
          isComplete: true,
          visitCount: 8,
          historyTimes: [],
          historyActivityIds: [],
        } as unknown as SectionEncounter,
      ]}
      coordinates={[]}
      isDark={false}
      isMetric
      sectionCreationMode={false}
      cacheDays={30}
      highlightedSectionId={null}
      onHighlightedSectionIdChange={onHighlight}
      onSectionCreationModeChange={jest.fn()}
      removeSection={jest.fn()}
      scanMatches={[]}
      hasScanned={false}
      onScan={jest.fn()}
      onRematch={jest.fn()}
    />
  );
  const row = mockSectionInlinePlot.mock.calls[0]?.[0] as {
    onRowHeight: (index: number, height: number) => void;
  };
  act(() => row.onRowHeight(0, 100));

  await settle(() => startOf(pans)({ x: 10, y: 50, absoluteY: 50 }));

  expect(onHighlight).toHaveBeenCalledWith('loop-1');
  expect(fired()).toEqual(ONE_LIGHT);
});
