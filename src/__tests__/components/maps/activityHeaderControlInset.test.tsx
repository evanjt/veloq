/**
 * Scenario: the activity hero's stats row shares the hero with the map's button column, and the
 * column holds only the buttons the activity has data for.
 *
 * Expected behaviour: the hero overlay's right padding clears the column's footprint, sized to the
 * buttons the map reports drawing rather than to the most it could ever hold.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import { DetailHero } from '@/shared/ui/DetailHero';
import { layout, spacing } from '@/theme';
import type { ActivityDetail } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

let mockDrawnControls = 0;

jest.mock('@/features/maps/components/ActivityMapView', () => ({
  ActivityMapView: ({
    onControlCountChange,
  }: {
    onControlCountChange?: (count: number) => void;
  }) => {
    const { useEffect: useMockEffect } = jest.requireActual('react');
    useMockEffect(() => {
      onControlCountChange?.(mockDrawnControls);
    }, [onControlCountChange]);
    return null;
  },
}));

const activity = {
  id: 'a1',
  name: 'Harbour paddle',
  type: 'Kayaking',
  start_date_local: '2026-08-12T07:30:00',
  distance: 8200,
  moving_time: 3600,
  total_elevation_gain: null,
  polyline: null,
} as unknown as ActivityDetail;

/** Short enough that six buttons wrap into a second column and three do not. */
const SHORT_HERO = 300;

const renderHero = () =>
  render(
    <ActivityHeader
      activity={activity}
      activityId={activity.id}
      coordinates={[]}
      hasStoredTrack={false}
      isMetric={true}
      debugEnabled={false}
      mapHeight={SHORT_HERO}
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

const overlayPaddingRight = () =>
  StyleSheet.flatten(screen.getByTestId('detail-hero-overlay').props.style).paddingRight;

describe('DetailHero overlay inset', () => {
  it('pads the overlay on the right by the inset it is given', async () => {
    const { getByTestId } = await render(
      <DetailHero height={250} overlayInsetEnd={72} overlay={<></>}>
        <></>
      </DetailHero>
    );
    const style = StyleSheet.flatten(getByTestId('detail-hero-overlay').props.style);
    expect(style.paddingRight).toBe(72);
  });
});

describe('activity hero control reserve', () => {
  it('reserves one button column when the map draws three buttons', async () => {
    mockDrawnControls = 3;
    await renderHero();
    expect(overlayPaddingRight()).toBe(layout.cardMargin + layout.minTapTarget + spacing.sm);
  });

  it('reserves a second column when six buttons wrap', async () => {
    mockDrawnControls = 6;
    await renderHero();
    expect(overlayPaddingRight()).toBe(layout.cardMargin + 2 * (layout.minTapTarget + spacing.sm));
  });

  it('reserves nothing when the map draws no buttons', async () => {
    mockDrawnControls = 0;
    await renderHero();
    expect(overlayPaddingRight() ?? 0).toBe(0);
  });
});
