/**
 * Scenario: a screen reader on the activity, route or section hero met a name with no heading
 * role and a stat strip read as separate fragments, '12.3 km', '·', '1:02:33', '·', '245 m',
 * with nothing naming what each number is.
 *
 * Expected behaviour: the hero name is a heading, and the stat strip is one element whose label
 * names each value, with the dot dividers kept out of the accessibility tree.
 */

import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import { DetailHero, HeroNameRow, HeroStatsRow } from '@/shared/ui/DetailHero';

import { activityRecord } from '../__shared__/activityRecord';
import type { ActivityRecord } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => false,
  }),
}));
jest.mock('@/features/maps/components/ActivityMapView', () => {
  const { View: MockView } = require('react-native');
  return { ActivityMapView: () => <MockView /> };
});

const activity = activityRecord({
  id: 'sample-1',
  name: 'Harbour loop',
  sportType: 'Ride',
  startDateLocal: '2026-08-12T07:30:00',
  distance: 12300,
  movingTime: 3753,
  elevationGain: 245,
  streamTypes: ['latlng'],
});

async function renderActivityHeader(shown: ActivityRecord = activity) {
  return render(
    <ActivityHeader
      activity={shown}
      activityId={shown.id}
      coordinates={[]}
      hasStoredTrack={false}
      isMetric={true}
      debugEnabled={false}
      mapHeight={320}
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
}

describe('the activity hero', () => {
  it('announces the activity name as a heading', async () => {
    await renderActivityHeader();
    expect(screen.getByRole('header', { name: 'Harbour loop' })).toBeTruthy();
  });

  it('reads distance, duration and elevation gain as one element naming each value', async () => {
    await renderActivityHeader();
    const strip = screen.getByLabelText(
      'activity.distance: 12.3 km, activity.duration: 1:02:33, sections.elevationGain: 245 m'
    );
    expect(strip.props.accessible).toBe(true);
    expect(screen.queryByText('·')).toBeNull();
  });

  it('reads only the time for a ride with no distance and no climb', async () => {
    await renderActivityHeader(
      activityRecord({
        ...activity,
        distance: 0,
        elevationGain: 0,
        streamTypes: ['time', 'watts'],
      })
    );
    expect(screen.getByTestId('activity-detail-stats').props.accessibilityLabel).toBe(
      'activity.duration: 1:02:33'
    );
    expect(screen.getByTestId('activity-detail-duration').props.children).toBe('1:02:33');
    expect(screen.queryByTestId('activity-detail-distance')).toBeNull();
  });
});

describe('the section and route hero', () => {
  const stats = [
    { text: '4.2 km', label: 'Distance: 4.2 km' },
    { text: '7 activities', label: '7 activities' },
    null,
    { text: '120 m', label: 'Elevation gain: 120 m' },
  ];

  async function renderHero(editable: boolean) {
    return render(
      <DetailHero
        height={320}
        overlay={
          <>
            <HeroNameRow
              name="Ridge climb"
              {...(editable && {
                editable: {
                  isEditing: false,
                  editName: '',
                  inputRef: React.createRef(),
                  label: 'Name',
                  testIDPrefix: 'sample',
                  onStartEdit: jest.fn(),
                  onSave: jest.fn(),
                  onCancel: jest.fn(),
                  onChange: jest.fn(),
                },
              })}
            />
            <HeroStatsRow testID="hero-stats" stats={stats} />
          </>
        }
      >
        <View />
      </DetailHero>
    );
  }

  it('announces a read-only name as a heading', async () => {
    await renderHero(false);
    expect(screen.getByRole('header', { name: 'Ridge climb' })).toBeTruthy();
  });

  it('announces a renameable name as a heading that still offers the rename', async () => {
    await renderHero(true);
    const heading = screen.getByRole('header', { name: 'Ridge climb' });
    expect(heading.props.accessibilityHint).toBe('common.rename');
    expect(heading.props.onClick ?? heading.props.onPress).toBeDefined();
  });

  it('reads its stats as one element naming each value, with no focusable divider', async () => {
    await renderHero(false);
    const strip = screen.getByTestId('hero-stats');
    expect(strip.props.accessible).toBe(true);
    expect(strip.props.accessibilityLabel).toBe(
      'Distance: 4.2 km, 7 activities, Elevation gain: 120 m'
    );
    expect(screen.getByText('4.2 km')).toBeTruthy();
    expect(screen.queryByText('·')).toBeNull();
  });
});
