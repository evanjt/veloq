import React, { useMemo, useEffect, useRef } from 'react';
import { View, ScrollView, StatusBar, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useConsensusRoute, useGroupDetail } from '@/features/routes/hooks/useRouteEngine';
import { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
import { useGpxExport } from '@/features/settings/hooks/exportIndex';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { ScreenErrorBoundary } from '@/shared/ui';

import {
  DataRangeFooter,
  RouteDetailLoading,
  RouteDetailMap,
  RouteDetailHeroHeader,
  RouteDetailHeaderInfo,
  SportTypeSelector,
  RouteDetailChart,
  RouteDetailDebugPanel,
  routeDetailScreenStyles as styles,
} from '@/features/routes';
import {
  useRouteHighlight,
  useSportTypeFilter,
  useRouteChartData,
  useRouteReference,
  useExcludedActivities,
  useRouteRenaming,
} from '@/features/routes/hooks';
import { buildRouteGroupBase, buildFinalRouteGroup } from '@/features/routes/lib/buildRouteGroup';
import { computeRouteStats } from '@/features/routes/lib/computeRouteStats';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { getActivityColor } from '@/features/activity/lib/activityUtils';
import { colors } from '@/theme';
import { toActivityType } from '@/features/routes/types';

export default function RouteDetailScreen() {
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

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  const { highlightedActivityId, highlightedActivityPoints, handleActivitySelect } =
    useRouteHighlight();

  // Get route group from engine using lightweight on-demand query (with LRU caching)
  const { group: engineGroup } = useGroupDetail(id || null);

  // Get unfiltered metrics to derive available sport types
  const { activityMetrics: allMetrics } = useRoutePerformances(id, engineGroup?.groupId);

  const { selectedSportType, setSelectedSportType, availableSportTypes, sportFilter } =
    useSportTypeFilter(allMetrics, engineGroup);

  // Get performance data filtered by selected sport type (no API call needed)
  // Activity metrics are cached in Rust engine's in-memory HashMap
  const {
    performances,
    best: bestPerformance,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
  } = useRoutePerformances(id, engineGroup?.groupId, sportFilter);

  // Get consensus route points from Rust engine
  const { points: consensusPoints } = useConsensusRoute(id);

  // Create a compatible routeGroup object with expected properties
  // Note: Native RouteGroup uses groupId, sportType, customName (different from extended type)
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
  } = useRouteRenaming(id, routeGroupBase?.name, t);

  // Compute stats from performances
  const routeStats = useMemo(() => computeRouteStats(performances), [performances]);

  const {
    showExcluded,
    excludedActivityIds,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    excludedChartData,
  } = useExcludedActivities(id, sportFilter);

  const { signatures, chartData: combinedChartData } = useRouteChartData(
    performances,
    bestPerformance,
    engineGroup,
    excludedChartData
  );

  // Final routeGroup with signature populated from consensus points
  const routeGroup = useMemo(
    () => buildFinalRouteGroup(routeGroupBase, consensusPoints, routeStats.distance),
    [routeGroupBase, consensusPoints, routeStats.distance]
  );

  if (!routeGroup) {
    return <RouteDetailLoading isDark={isDark} insets={insets} onBackPress={() => router.back()} />;
  }

  // Use selected sport type for color/icon when filtering
  const displayType = sportFilter ? toActivityType(sportFilter) : routeGroup.type;
  const activityColor = getActivityColor(displayType);
  // Map data check - have activities if we have performances
  const hasMapData = performances.length > 0;

  return (
    <ScreenErrorBoundary screenName="Route Detail">
      <View testID="route-detail-screen" style={[styles.container, isDark && styles.containerDark]}>
        <StatusBar barStyle="light-content" />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Map Section */}
          <View style={styles.heroSection}>
            <RouteDetailMap
              routeGroup={routeGroup}
              highlightedActivityId={highlightedActivityId}
              highlightedActivityPoints={highlightedActivityPoints}
              signatures={signatures}
              hasMapData={hasMapData}
              activityColor={activityColor}
            />

            {/* Gradient overlay at bottom */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={styles.mapGradient}
              pointerEvents="none"
            />

            <RouteDetailHeroHeader onBackPress={() => router.back()} insets={insets} />

            <RouteDetailHeaderInfo
              customName={customName}
              routeName={routeGroup.name}
              isEditing={isEditing}
              editName={editName}
              nameInputRef={nameInputRef}
              displayType={displayType}
              activityColor={activityColor}
              routeStats={routeStats}
              activityCount={routeGroup.activityCount}
              isMetric={isMetric}
              onStartEdit={handleStartEditing}
              onSaveName={handleSaveName}
              onCancelEdit={handleCancelEdit}
              onEditNameChange={setEditName}
            />
          </View>

          {/* Sport type selector — shown when route has multiple sport types */}
          {availableSportTypes.length > 1 && (
            <SportTypeSelector
              availableSportTypes={availableSportTypes}
              selectedSportType={selectedSportType}
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
                activityType={displayType}
                isDark={isDark}
                bestForwardRecord={bestForwardRecord}
                bestReverseRecord={bestReverseRecord}
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
            {consensusPoints && consensusPoints.length > 0 && (
              <TouchableOpacity
                testID="route-export-gpx"
                style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
                onPress={() =>
                  exportGpx({
                    name: customName || routeGroup?.name || 'Route',
                    points: consensusPoints.map((p) => ({
                      latitude: p.lat,
                      longitude: p.lng,
                    })),
                    sport: engineGroup?.sportType,
                  })
                }
                disabled={gpxExporting}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={gpxExporting ? 'progress-download' : 'download'}
                  size={20}
                  color={colors.textOnPrimary}
                />
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
    </ScreenErrorBoundary>
  );
}
