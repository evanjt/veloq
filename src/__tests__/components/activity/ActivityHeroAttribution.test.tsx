/**
 * Scenario: the activity hero paints its title, date and stats over the map,
 * and the map paints its source attribution in the same bottom corner.
 *
 * Expected behaviour: the hero overlay reserves enough room for the
 * attribution pill, so the attribution stays readable whatever the safe-area
 * inset is and however tall the hero content grows.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import type { ActivityRecord } from 'veloqrs';
import { activityRecord } from '../../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/maps/components/ActivityMapView', () => {
  const { AttributionOverlay } = jest.requireActual(
    '@/features/maps/components/AttributionOverlay'
  );
  return {
    ActivityMapView: ({
      onAttributionClearanceChange,
    }: {
      onAttributionClearanceChange?: (clearance: number) => void;
    }) => (
      <AttributionOverlay
        initialAttribution="© swisstopo © OpenStreetMap"
        onClearanceChange={onAttributionClearanceChange}
      />
    ),
  };
});

const activity = (overrides: Partial<ActivityRecord> = {}): ActivityRecord =>
  ({
    ...activityRecord({
      name: 'Lausanne half marathon',
      sportType: 'Run',
      startDateLocal: '2026-08-12T07:30:00',
      distance: 21097,
      movingTime: 17209,
      elevationGain: 1047,
    }),
    ...overrides,
  }) as ActivityRecord;

const renderHero = (insetTop: number, detail: ActivityRecord) =>
  render(
    <ActivityHeader
      activity={detail}
      activityId={detail.id}
      coordinates={[]}
      hasStoredTrack={false}
      isMetric={true}
      debugEnabled={false}
      mapHeight={360}
      highlightIndex={null}
      sectionCreationMode={false}
      sectionCreationState={undefined}
      sectionCreationError={null}
      onSectionCreated={jest.fn()}
      onCreationCancelled={jest.fn()}
      onCreationErrorDismiss={jest.fn()}
      on3DModeChange={jest.fn()}
      onStyleChange={jest.fn()}
      onCameraCapture={jest.fn()}
      initial3DCamera={null}
      activeTab="charts"
      routeOverlayCoordinates={null}
      sectionOverlays={null}
      highlightedSectionId={null}
    />
  );

/** Vertical space the attribution pill claims, read off what it actually renders. */
const attributionHeight = () => {
  const anchor = StyleSheet.flatten(screen.getByTestId('map-attribution').props.style);
  const pill = StyleSheet.flatten(screen.getByTestId('map-attribution-pill').props.style);
  const text = StyleSheet.flatten(screen.getByTestId('map-attribution-text').props.style);
  return (
    (anchor.paddingBottom ?? 0) +
    (pill.paddingVertical ?? 0) * 2 +
    (text.lineHeight ?? text.fontSize ?? 0)
  );
};

const overlayPaddingBottom = () =>
  StyleSheet.flatten(screen.getByTestId('detail-hero-overlay').props.style).paddingBottom ?? 0;

describe('activity hero clears the map attribution', () => {
  const cases: [string, number, ActivityRecord][] = [
    ['no safe-area inset', 0, activity()],
    ['a large safe-area inset', 62, activity()],
    ['the tallest hero content', 62, activity()],
  ];

  it.each(cases)('leaves the attribution uncovered with %s', async (_label, insetTop, detail) => {
    await renderHero(insetTop, detail);

    expect(screen.getByTestId('map-attribution-text')).toBeTruthy();
    expect(overlayPaddingBottom()).toBeGreaterThanOrEqual(attributionHeight());
  });

  it('grows the reservation when the credit line wraps to a second row', async () => {
    await renderHero(0, activity());
    const oneLine = overlayPaddingBottom();

    // Satellite with 3D on runs to two rows at phone width, which the
    // single-line estimate does not cover.
    const twoLines = attributionHeight() * 2;
    await fireEvent(screen.getByTestId('map-attribution-pill'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: twoLines } },
    });

    expect(overlayPaddingBottom()).toBeGreaterThan(oneLine);
    expect(overlayPaddingBottom()).toBeGreaterThanOrEqual(twoLines);
  });

  it('gives the room back when the credit line fits on one row again', async () => {
    await renderHero(0, activity());
    const oneLine = attributionHeight();

    const layoutTo = async (height: number) =>
      await fireEvent(screen.getByTestId('map-attribution-pill'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height } },
      });

    await layoutTo(oneLine * 2);
    const wrapped = overlayPaddingBottom();
    await layoutTo(oneLine);

    expect(overlayPaddingBottom()).toBeLessThan(wrapped);
    expect(overlayPaddingBottom()).toBeGreaterThanOrEqual(oneLine);
  });
});

describe('activity hero place line', () => {
  it('shows nothing for a locality an older stored body still carries', async () => {
    await renderHero(
      0,
      activity({ locality: 'Lausanne', country: 'Switzerland' } as Partial<ActivityRecord>)
    );

    expect(screen.queryByText(/Lausanne,|^Lausanne$/)).toBeNull();
    expect(screen.queryByText(/Switzerland/)).toBeNull();
  });
});
