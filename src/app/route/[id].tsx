import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { isEngineReady } from '@/shared/native/engine';
import {
  useRoutePerformances,
  useRouteDetailData,
  DataRangeFooter,
  DetailFallback,
  RouteDetailMap,
  SportTypeSelector,
  RouteDetailChart,
  RouteDetailDebugPanel,
  routeDetailScreenStyles as styles,
  useRouteHighlight,
  useSportTypeFilter,
  useRouteChartData,
  useRouteReference,
  useExcludedActivities,
  useRouteRenaming,
  buildRouteGroupBase,
  buildFinalRouteGroup,
  routeHeadline,
  toActivityType,
} from '@/features/routes';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import {
  DetailHero,
  EngineReadFailure,
  HeroNameRow,
  HeroStatsRow,
  useHeroMapHeight,
} from '@/shared/ui';

import { useFFITimer } from '@/shared/debug/useFFITimer';
import { getActivityColor, getActivityIcon } from '@/shared/activity/activityUtils';
import { formatDistance, formatRelativeDate } from '@/shared/format/format';
import { decodeCoords } from 'veloqrs';
import type { FfiActivityMetrics } from 'veloqrs';
import { colors } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function RouteDetailScreenContent() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RouteDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id, activityId: navActivityId } = useLocalSearchParams<{
    id: string;
    activityId?: string;
  }>();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const insets = useSafeAreaInsets();
  const mapHeight = useHeroMapHeight();

  // One engine call covering the route, its ranking list, every attempt, the
  // representative polyline, names, exclusions and signatures.
  const [detailRetryTick, setDetailRetryTick] = useState(0);
  const { data: detail, status: detailStatus } = useRouteDetailData(
    id,
    navActivityId,
    detailRetryTick
  );

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays(detail?.activityCount);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  const { highlightedActivityId, highlightedActivityPoints, handleActivitySelect } =
    useRouteHighlight();

  const engineGroup = detail?.group;

  // Sport pills come from the unfiltered attempts the bundle already carries.
  const allMetrics = useMemo(() => {
    const map = new Map<string, FfiActivityMetrics>();
    for (const m of detail?.performances.activityMetrics ?? []) {
      map.set(m.activityId, m);
    }
    return map;
  }, [detail]);

  const { selectedSportType, setSelectedSportType, availableSportTypes, sportFilter } =
    useSportTypeFilter(allMetrics);

  // Get performance data filtered by selected sport type. Without a filter the
  // bundle's unfiltered result is the answer, so no second read is made.
  const preComputedPerformances = useMemo(
    () =>
      detail
        ? {
            groups: detail.groups,
            result: sportFilter ? undefined : detail.performances,
          }
        : undefined,
    [detail, sportFilter]
  );
  const {
    performances,
    best: bestPerformance,
    bestForwardRecord,
    bestReverseRecord,
    bestForwardIsRecord,
    bestReverseIsRecord,
    forwardStats,
    reverseStats,
    trendCurves,
    histograms,
  } = useRoutePerformances(id, engineGroup?.groupId, sportFilter, preComputedPerformances);

  // Representative route points, decoded from the bundle.
  const representativePoints = useMemo(() => {
    if (!detail?.encodedRepresentative) return null;
    const decoded = decodeCoords(detail.encodedRepresentative);
    if (decoded.length === 0) return null;
    return decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  }, [detail]);

  // Create a compatible routeGroup object with expected properties
  // Native RouteGroup uses groupId and customName.
  // Names are stored in Rust (user-set or auto-generated on creation/migration)
  const routeGroupBase = useMemo(() => buildRouteGroupBase(engineGroup), [engineGroup]);

  const { effectiveRepresentativeId, handleSetAsReference } = useRouteReference(
    id,
    engineGroup?.representativeId,
    t
  );

  const {
    isEditing,
    editName,
    setEditName,
    customName,
    nameInputRef,
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
  } = useRouteRenaming(id, routeGroupBase?.name, t, detail?.routeNames);

  // The hero describes the route, so it reads the engine's figures and the
  // sport chip, which only filters the attempts below it, does not move them.
  const routeStats = useMemo(() => routeHeadline(detail), [detail]);

  const {
    showExcluded,
    excludedActivityIds,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    excludedChartData,
    excludedReadError,
  } = useExcludedActivities(id, sportFilter, detail?.excludedActivityIds);

  const directionBests = useMemo(
    () => ({ forward: bestForwardRecord, reverse: bestReverseRecord }),
    [bestForwardRecord, bestReverseRecord]
  );

  const { signatures, chartData: combinedChartData } = useRouteChartData(
    performances,
    engineGroup,
    excludedChartData,
    detail?.mapSignatures,
    directionBests
  );

  // Final routeGroup with signature populated from representative points.
  const routeGroup = useMemo(
    () => buildFinalRouteGroup(routeGroupBase, representativePoints, routeStats.distance),
    [routeGroupBase, representativePoints, routeStats.distance]
  );

  if (!routeGroup) {
    return (
      <DetailFallback
        isDark={isDark}
        insetTop={insets.top}
        status={detailStatus}
        loading={!isEngineReady()}
        onRetry={() => setDetailRetryTick((k) => k + 1)}
        notFoundMessage={t('routeDetail.routeNotFound')}
      />
    );
  }

  const displayName = customName || routeGroup.name;

  // Use selected sport type for color/icon when filtering
  const displayType = toActivityType(selectedSportType);
  const activityColor = getActivityColor(displayType);
  // Map data check - have activities if we have performances
  const hasMapData = performances.length > 0;

  return (
    <View testID="route-detail-screen" style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {excludedReadError !== undefined ? (
          <EngineReadFailure error={excludedReadError} testID="route-excluded-failure" />
        ) : null}

        {/* Hero Map Section */}
        <DetailHero
          height={mapHeight}
          overlay={
            <>
              <HeroNameRow
                name={displayName}
                nameTestID="route-detail-name"
                icon={{ name: getActivityIcon(displayType), color: activityColor }}
                editable={{
                  isEditing,
                  editName,
                  inputRef: nameInputRef,
                  placeholder: t('routes.routeNamePlaceholder'),
                  testIDPrefix: 'route',
                  onStartEdit: handleStartEditing,
                  onSave: handleSaveName,
                  onCancel: handleCancelEdit,
                  onChange: setEditName,
                }}
              />
              <HeroStatsRow
                testID="route-detail-stats"
                stats={[
                  formatDistance(routeStats.distance, isMetric),
                  t('maps.activitiesCount', { count: routeGroup.activityCount }),
                  routeStats.lastDate ? formatRelativeDate(routeStats.lastDate) : '-',
                ]}
              />
            </>
          }
        >
          <RouteDetailMap
            routeGroup={routeGroup}
            highlightedActivityId={highlightedActivityId}
            highlightedActivityPoints={highlightedActivityPoints}
            signatures={signatures}
            hasMapData={hasMapData}
            activityColor={activityColor}
            selectedSportType={selectedSportType ? displayType : undefined}
          />
        </DetailHero>

        {/* Sport type selector - shown when route has multiple sport types */}
        {availableSportTypes.length > 1 && (
          <SportTypeSelector
            options={availableSportTypes.map((type) => ({ type }))}
            selectedType={selectedSportType}
            onSelect={setSelectedSportType}
            isDark={isDark}
          />
        )}

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Performance scatter chart with eye toggle */}
          {combinedChartData.length >= 1 && (
            <RouteDetailChart
              chartData={combinedChartData}
              trendCurves={trendCurves}
              histograms={histograms}
              activityType={displayType}
              isDark={isDark}
              bestForwardRecord={bestForwardRecord}
              bestReverseRecord={bestReverseRecord}
              bestForwardIsRecord={bestForwardIsRecord}
              bestReverseIsRecord={bestReverseIsRecord}
              forwardStats={forwardStats}
              reverseStats={reverseStats}
              onActivitySelect={handleActivitySelect}
              onExcludeActivity={handleExcludeActivity}
              onIncludeActivity={handleIncludeActivity}
              onSetAsReference={handleSetAsReference}
              referenceActivityId={effectiveRepresentativeId}
              showExcluded={showExcluded}
              hasExcluded={excludedActivityIds.size > 0}
              onToggleShowExcluded={handleToggleShowExcluded}
              highlightedActivityId={navActivityId}
            />
          )}

          {/* Export GPX button */}
          {representativePoints && representativePoints.length > 0 && (
            <TouchableOpacity
              testID="route-export-gpx"
              style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
              onPress={() =>
                exportGpx({
                  name: displayName,
                  points: representativePoints.map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng,
                  })),
                  sport: selectedSportType,
                })
              }
              disabled={gpxExporting}
              activeOpacity={0.7}
            >
              {gpxExporting ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <MaterialCommunityIcons name="download" size={20} color={colors.textOnPrimary} />
              )}
              <Text style={styles.exportGpxButtonText}>
                {gpxExporting ? t('export.exporting') : t('export.gpx')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Data range footer */}
          <DataRangeFooter days={cacheDays} isDark={isDark} />

          {debugEnabled && engineGroup && (
            <RouteDetailDebugPanel
              engineGroup={engineGroup}
              routeStats={routeStats}
              bestPerformance={bestPerformance}
              pageMetrics={getPageMetrics()}
              isDark={isDark}
              isMetric={isMetric}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(RouteDetailScreenContent, 'Route Detail');
