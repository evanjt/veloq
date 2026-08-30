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
import { render, screen } from '@testing-library/react-native';

import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import type { ActivityDetail } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('@/features/maps/components/ActivityMapView', () => {
  const { AttributionOverlay } = jest.requireActual(
    '@/features/maps/components/AttributionOverlay'
  );
  return {
    ActivityMapView: () => <AttributionOverlay initialAttribution="© swisstopo © OpenStreetMap" />,
  };
});

const activity = (overrides: Partial<ActivityDetail> = {}): ActivityDetail =>
  ({
    id: 'a1',
    name: 'Lausanne half marathon',
    type: 'Run',
    start_date_local: '2026-08-12T07:30:00',
    distance: 21097,
    moving_time: 17209,
    total_elevation_gain: 1047,
    polyline: null,
    ...overrides,
  }) as ActivityDetail;

const renderHero = (insetTop: number, detail: ActivityDetail) =>
  render(
    <ActivityHeader
      activity={detail}
      activityId={detail.id}
      coordinates={[]}
      isMetric={true}
      debugEnabled={false}
      insetTop={insetTop}
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
  const cases: [string, number, ActivityDetail][] = [
    ['no safe-area inset', 0, activity()],
    ['a large safe-area inset', 62, activity()],
    ['the tallest hero content', 62, activity({ locality: 'Lausanne', country: 'Switzerland' })],
  ];

  it.each(cases)('leaves the attribution uncovered with %s', (_label, insetTop, detail) => {
    renderHero(insetTop, detail);

    expect(screen.getByTestId('map-attribution-text')).toBeTruthy();
    expect(overlayPaddingBottom()).toBeGreaterThanOrEqual(attributionHeight());
  });

  it('spends the safe-area inset on the top header, not the bottom overlay', () => {
    renderHero(0, activity());
    const withoutInset = overlayPaddingBottom();
    screen.unmount();

    renderHero(62, activity());
    const header = StyleSheet.flatten(screen.getByTestId('detail-hero-header').props.style);

    expect(header.paddingTop).toBe(62);
    expect(overlayPaddingBottom()).toBe(withoutInset);
  });
});
