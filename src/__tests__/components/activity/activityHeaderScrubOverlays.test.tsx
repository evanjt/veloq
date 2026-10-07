/**
 * Scenario: the athlete scrubs the chart on the activity's charts tab, which
 * re-renders the header with a new highlight index every tick.
 *
 * Expected behaviour: the header hands the map the same section overlays on
 * every tick, so the map rebuilds no section source during the scrub.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import type { SectionOverlay } from '@/features/maps';
import type { ActivityDetail } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

const mockMapProps: { sectionOverlays?: SectionOverlay[] | null }[] = [];

jest.mock('@/features/maps/components/ActivityMapView', () => ({
  ActivityMapView: (props: { sectionOverlays?: SectionOverlay[] | null }) => {
    mockMapProps.push(props);
    return null;
  },
}));

const activity = {
  id: 'a1',
  name: 'Gurten loop',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 32000,
  moving_time: 4200,
  total_elevation_gain: 610,
  polyline: null,
} as unknown as ActivityDetail;

const point = { latitude: 46.948, longitude: 7.447 };

const overlays: SectionOverlay[] = [
  { id: 'pr', sectionPolyline: [point, point], activityPortion: [point, point], isPR: true },
  { id: 'plain', sectionPolyline: [point, point], activityPortion: [point, point] },
];

const header = (activeTab: string, highlightIndex: number | null) => (
  <ActivityHeader
    activity={activity}
    activityId={activity.id}
    coordinates={[]}
    isMetric={true}
    debugEnabled={false}
    mapHeight={360}
    highlightIndex={highlightIndex}
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
    activeTab={activeTab}
    routeOverlayCoordinates={null}
    sectionOverlays={overlays}
    highlightedSectionId={null}
  />
);

beforeEach(() => {
  mockMapProps.length = 0;
});

it.each(['charts', 'sections'])('hands the map one overlay list across a scrub on %s', (tab) => {
  const view = render(header(tab, 0));
  for (const index of [1, 2, 3]) view.rerender(header(tab, index));

  const handed = mockMapProps.map((p) => p.sectionOverlays);
  expect(handed.length).toBeGreaterThan(1);
  for (const list of handed) expect(list).toBe(handed[0]);
  expect(handed[0]).not.toBeNull();
  expect(handed[0]).toBe(overlays);
});

it('hands the map no section overlays on the routes tab', () => {
  render(header('routes', null));

  expect(mockMapProps[mockMapProps.length - 1].sectionOverlays).toBeNull();
});
