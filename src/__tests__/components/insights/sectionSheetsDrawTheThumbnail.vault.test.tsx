/**
 * Scenario: the section record sheet drew the section through a map of its
 * own, its line in gold, while every other section thumbnail is the one track
 * preview in the base map's route colour.
 *
 * Expected behaviour: the sheet draws the section as the track preview at the
 * sheet's width in the base map's route colour, and draws nothing from fewer
 * than two points. The stale-record sheet draws its section on a basemap
 * instead, held by its own test.
 */

import React from 'react';
import { View } from 'react-native';
import { Polyline } from 'react-native-svg';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import { TrackPreview, trackPreviewPalette } from '@/shared/ui/TrackPreview';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const LOOP = [
  { lat: 46.52, lng: 6.56 },
  { lat: 46.53, lng: 6.58 },
  { lat: 46.54, lng: 6.61 },
];

let mockPolyline: { lat: number; lng: number }[] = LOOP;

jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({
    section: { id: 'ridge', sportTypes: ['Ride'], activityPortions: [], polyline: mockPolyline },
  }),
}));
jest.mock('@/features/routes', () => ({
  useSectionPerformances: () => ({
    records: [],
    bests: { forward: null, reverse: null, forwardIsPr: false, reverseIsPr: false },
    isLoading: false,
  }),
}));

beforeAll(() => initialiseI18n('en-GB'));
beforeEach(() => {
  mockPolyline = LOOP;
});

const SHEET_WIDTH = 320;

/** The track preview is memoised, so the tree holds the function it wraps. */
const previews = () =>
  screen.UNSAFE_queryAllByType((TrackPreview as unknown as { type: React.ComponentType }).type);

async function layout() {
  const measured = screen.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout);
  await act(async () => {
    for (const node of measured) {
      await fireEvent(node, 'layout', {
        nativeEvent: { layout: { width: SHEET_WIDTH, height: 150 } },
      });
    }
  });
}

function sheet(category: Insight['category']): Insight {
  return {
    id: category,
    category,
    priority: 2,
    title: category,
    icon: 'map',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: false,
    supportingData: {
      sections: [{ sectionId: 'ridge', sectionName: 'Ridge', bestTime: 300, sportType: 'Ride' }],
    },
  } as Insight;
}

const SHEETS = [
  ['section record', () => <SectionPRContent insight={sheet('section_pr')} />],
] as const;

describe.each(SHEETS)('the %s sheet', (_name, Sheet) => {
  it('draws the section as the track preview at the sheet width in the route colour', async () => {
    await render(<Sheet />);
    await layout();
    const drawn = previews();
    expect(drawn).toHaveLength(1);
    expect(drawn[0].props.width).toBe(SHEET_WIDTH);
    expect(screen.UNSAFE_getAllByType(Polyline).map((line) => line.props.stroke)).toContain(
      trackPreviewPalette(false).route
    );
    expect(drawn[0].props.points).toHaveLength(LOOP.length);
  });

  it('draws no section from fewer than two usable points', async () => {
    mockPolyline = [LOOP[0], { lat: Number.NaN, lng: Number.NaN }];
    await render(<Sheet />);
    await layout();
    expect(previews()).toHaveLength(0);
  });
});
