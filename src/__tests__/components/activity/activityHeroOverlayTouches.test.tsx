/**
 * Scenario: the activity hero draws its name, date, stats and location over
 * the map, and the map must still pan and pinch under the empty parts.
 *
 * Expected behaviour: with debug off nothing in the overlay takes a touch.
 * With debug on, the name is the only control and it is sized to its text.
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

jest.mock('@/features/maps/components/ActivityMapView', () => ({
  ActivityMapView: () => null,
}));

const activity = {
  id: 'a1',
  name: 'Ride',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 21097,
  moving_time: 3609,
  total_elevation_gain: 147,
  polyline: null,
} as unknown as ActivityDetail;

const renderHeader = (debugEnabled: boolean) =>
  render(
    <ActivityHeader
      activity={activity}
      activityId={activity.id}
      coordinates={[]}
      isMetric={true}
      debugEnabled={debugEnabled}
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

type Node = {
  type: string;
  props: Record<string, unknown>;
  children: (Node | string)[] | null;
};

/** Host elements under the overlay that can take a touch, outside any `none` subtree. */
const touchTakers = (node: Node, blocked = false): string[] => {
  const mode = node.props.pointerEvents;
  const dead = blocked || mode === 'none';
  const takes =
    !dead &&
    mode !== 'box-none' &&
    (node.props.onStartShouldSetResponder !== undefined ||
      node.props.onResponderGrant !== undefined ||
      node.type === 'View');
  const own = takes ? [String(node.props.testID ?? node.type)] : [];
  return own.concat(
    (node.children ?? [])
      .filter((c): c is Node => typeof c !== 'string')
      .flatMap((c) => touchTakers(c, dead))
  );
};

describe('activity hero overlay touches', () => {
  it('takes no touch anywhere in the overlay with debug off', () => {
    renderHeader(false);
    const overlay = screen.getByTestId('detail-hero-overlay');
    const root = screen.toJSON() as unknown as Node;
    const find = (n: Node): Node | null =>
      n.props?.testID === 'detail-hero-overlay'
        ? n
        : ((n.children ?? [])
            .filter((c): c is Node => typeof c !== 'string')
            .map(find)
            .find(Boolean) ?? null);
    const node = find(
      Array.isArray(root) ? ({ type: 'root', props: {}, children: root } as Node) : root
    );
    expect(overlay).toBeTruthy();
    const takers = (node!.children ?? [])
      .filter((c): c is Node => typeof c !== 'string')
      .flatMap((c) => touchTakers(c));
    expect(takers).toEqual([]);
  });

  it('sizes the debug name control to its text', () => {
    renderHeader(true);
    const name = screen.getByTestId('activity-detail-name');
    expect(StyleSheet.flatten(name.props.style).alignSelf).toBe('flex-start');
  });
});
