/**
 * Scenario: icon-only and text-only controls drawn smaller than the platform
 * tap-target minimum.
 *
 * Expected behaviour: each control's drawn size, plus any hit slop, reaches
 * `layout.minTapTarget` on both axes.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { i18n, initialiseI18n } from '@/i18n';
import { HeroNameRow } from '@/shared/ui/DetailHero';
import { FeedFilterChips } from '@/features/activity/components/FeedFilterChips';
import { SectionsListFiltersBar } from '@/features/routes/components/SectionsListFiltersBar';
import { SheetHeader } from '@/shared/ui/SheetHeader';
import { TrackFetchNotice } from '@/shared/ui/TrackFetchNotice';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { GroupingParamPanel } from '@/features/routes/components/preview/GroupingParamPanel';
import { DETECTION_PRESETS } from '@/features/routes/lib/detectionParams';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { SelectedAttemptCard } from '@/features/routes/components/section/SelectedAttemptCard';
import type { WellnessData } from '@/types';
import { SearchBar } from '@/shared/ui/SearchBar';
import { CHIP_HEIGHT, ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { SummaryCard } from '@/features/home/components/SummaryCard';
import { RoutesList } from '@/features/routes/components/RoutesList';
import { layout } from '@/theme/layout';
import type { GroupWithPolyline } from 'veloqrs';

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false, colors: require('@/theme').colors }),
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));
jest.mock('@/features/routes/components/DataRangeFooter', () => ({
  DataRangeFooter: () => null,
}));
jest.mock('@/features/routes/components/RouteRow', () => ({ RouteRow: () => null }));
jest.mock('@/features/routes/lib/batchGroupToRouteGroup', () => ({
  batchGroupToRouteGroup: (group: { groupId: string }) => ({ id: group.groupId, name: '' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

type Slop = number | { top?: number; bottom?: number; left?: number; right?: number } | undefined;

function slopOn(slop: Slop, side: 'top' | 'bottom' | 'left' | 'right'): number {
  if (typeof slop === 'number') return slop;
  return slop?.[side] ?? 0;
}

function reach(node: { props: { style?: unknown; hitSlop?: Slop } }) {
  const resolved =
    typeof node.props.style === 'function'
      ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : node.props.style;
  const style = StyleSheet.flatten(resolved as never) as Record<string, number | undefined>;
  const { hitSlop } = node.props;
  return {
    width:
      Math.max(style.width ?? 0, style.minWidth ?? 0) +
      slopOn(hitSlop, 'left') +
      slopOn(hitSlop, 'right'),
    height:
      Math.max(style.height ?? 0, style.minHeight ?? 0) +
      slopOn(hitSlop, 'top') +
      slopOn(hitSlop, 'bottom'),
  };
}

describe('tap-target floor', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('holds the rename save and cancel controls to the minimum', async () => {
    await render(
      <HeroNameRow
        name="Lake loop"
        editable={{
          isEditing: true,
          editName: 'Lake loop',
          inputRef: { current: null },
          label: 'Name',
          testIDPrefix: 'route',
          onStartEdit: jest.fn(),
          onSave: jest.fn(),
          onCancel: jest.fn(),
          onChange: jest.fn(),
        }}
      />
    );

    for (const control of [
      screen.getByTestId('route-rename-save'),
      screen.getByLabelText('Cancel'),
    ]) {
      const { width, height } = reach(control);
      expect(width).toBeGreaterThanOrEqual(layout.minTapTarget);
      expect(height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('holds the sheet title row Cancel and confirm to the minimum', async () => {
    await render(
      <SheetHeader
        title="Edit distance"
        onCancel={jest.fn()}
        cancelTestID="sheet-cancel"
        confirm={{ label: 'Save', onPress: jest.fn(), testID: 'sheet-confirm' }}
      />
    );

    for (const control of [
      screen.getByTestId('sheet-cancel'),
      screen.getByTestId('sheet-confirm'),
    ]) {
      const { width, height } = reach(control);
      expect(width).toBeGreaterThanOrEqual(layout.minTapTarget);
      expect(height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('holds the track notice dismiss to the minimum height', async () => {
    useTrackFetchNotice.setState({ failedIds: [], failedCount: 2, dismissed: false });
    await render(<TrackFetchNotice />);

    expect(reach(screen.getByTestId('track-fetch-notice-dismiss')).height).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
  });

  it('holds the feed filter chips to the minimum height', async () => {
    await render(
      <FeedFilterChips
        selected={new Set()}
        onSelect={jest.fn()}
        selectedRange={null}
        onSelectRange={jest.fn()}
      />
    );

    const chip = screen.getByTestId('home-filter-ride');
    expect(reach(chip).height).toBeGreaterThanOrEqual(layout.minTapTarget);
  });

  it('holds the sections sort and each filter chip to the minimum height', async () => {
    const { getAllByRole } = await render(
      <SectionsListFiltersBar
        regularSectionsCount={2}
        sortOption="name"
        onSortChange={jest.fn()}
        sortChips={[{ key: 'name', label: 'Name' }]}
        customCount={1}
        hiddenFilters={{ custom: false, auto: false, disabled: false, unaccepted: false }}
        onFilterPress={jest.fn()}
        trueDisabledCount={1}
        unacceptedAutoCount={1}
        acceptedAutoCount={1}
      />
    );

    const controls = getAllByRole('button');
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      expect(reach(control).height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('holds every preview parameter caption that opens the editor to the minimum height', async () => {
    const detection = await render(
      <PreviewParamPanel params={{ ...DETECTION_PRESETS.default }} onChange={jest.fn()} />
    );
    const detectionEdits = Object.keys(DETECTION_PRESETS.default).map((key) =>
      detection.getByTestId(`param-edit-${key}`)
    );
    const grouping = await render(
      <GroupingParamPanel
        params={{ minMatchPercentage: 65, endpointThreshold: 200 }}
        onChange={jest.fn()}
      />
    );
    const groupingEdits = ['minMatchPercentage', 'endpointThreshold'].map((key) =>
      grouping.getByTestId(`grouping-edit-${key}`)
    );

    for (const edit of [...detectionEdits, ...groupingEdits]) {
      expect(reach(edit).height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('holds the fitness legend toggles to the minimum height', async () => {
    const days = [
      { id: '2026-04-01', ctl: 40, atl: 48 },
      { id: '2026-04-02', ctl: 41, atl: 49 },
    ] as WellnessData[];
    await render(<FitnessChart data={days} />);

    for (const label of ['fitness.fitnessCTL', 'fitness.fatigueATL'] as const) {
      expect(reach(screen.getByLabelText(i18n.t(label))).height).toBeGreaterThanOrEqual(
        layout.minTapTarget
      );
    }
  });

  it('holds the selected attempt card exclude and include controls to the minimum', async () => {
    const point = {
      id: 'p1',
      activityId: 'a1',
      speed: 4,
      date: new Date('2026-01-01T00:00:00Z'),
      activityName: 'Harbour loop',
      direction: 'same' as const,
      sectionTime: 200,
      isBest: false,
      x: 0,
    };
    const tooltip = (isExcluded: boolean) => (
      <SelectedAttemptCard
        attempt={{ ...point, isExcluded }}
        isDark={false}
        activityType="Run"
        basis="pace"
        progression={[]}
        recordsSettled
        onSetAsReference={jest.fn()}
        onExcludeActivity={jest.fn()}
        onIncludeActivity={jest.fn()}
      />
    );

    const { rerender } = await render(tooltip(false));
    // Labelled buttons: the label sets the width, the slop holds the height to the floor.
    for (const label of ['sections.attemptExclude', 'sections.setAsReference'] as const) {
      expect(screen.getByText(i18n.t(label))).toBeTruthy();
      const { height } = reach(screen.getByRole('button', { name: i18n.t(label) }));
      expect(height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }

    await rerender(tooltip(true));
    expect(screen.getByText(i18n.t('sections.attemptInclude'))).toBeTruthy();
    const { height } = reach(
      screen.getByRole('button', { name: i18n.t('sections.attemptInclude') })
    );
    expect(height).toBeGreaterThanOrEqual(layout.minTapTarget);
  });

  it('holds the search field to the minimum height and names it', () => {
    render(
      <SearchBar value="" onChangeText={jest.fn()} placeholder="Search routes" testID="search" />
    );

    const input = screen.getByTestId('search');
    expect(reach(input).height).toBeGreaterThanOrEqual(layout.minTapTarget);
    expect(input.props.accessibilityLabel).toBe('Search routes');
  });

  it('holds every one-line chart chip to the minimum height through its slop', () => {
    const available = Object.values(CHART_CONFIGS).filter((config) =>
      ['power', 'heartrate', 'speed'].includes(config.id)
    );
    render(<ChartTypeSelector available={available} selected={['power']} onToggle={jest.fn()} />);
    for (const config of available) {
      const chip = screen.getByTestId(`chart-type-${config.id}`);
      expect(StyleSheet.flatten(chip.props.style).minHeight).toBe(CHIP_HEIGHT);
      expect(CHIP_HEIGHT).toBeLessThan(layout.minTapTarget);
      expect(reach(chip).height).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('holds a summary card metric to the minimum height', async () => {
    render(
      <SummaryCard
        heroValue={42}
        heroLabel="Fitness"
        showSparkline={false}
        supportingMetrics={[{ label: 'Form', value: '-3', navigationTarget: '/fitness' }]}
      />
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(reach(screen.getByTestId('summary-card-metric-0')).height).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
  });

  it('holds the routes sort to the minimum height', () => {
    const group = (groupId: string) => ({ groupId }) as unknown as GroupWithPolyline;
    render(
      <RoutesList
        batchGroups={[group('a'), group('b')]}
        sortOption="activities"
        onSortChange={jest.fn()}
        searchQuery=""
        onSearchChange={jest.fn()}
        totalGroupCount={2}
        shownGroupCount={2}
      />
    );

    expect(reach(screen.getByTestId('routes-sort')).height).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
  });
});
