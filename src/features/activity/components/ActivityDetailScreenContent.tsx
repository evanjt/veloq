import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { DetailCardStack, DetailMapHost } from '@/features/routes';
import { useTheme } from '@/shared/app';
import { MapSheetHostMap, useMapSheetHost, useMapSheetHostHeader } from '@/shared/app/MapSheetHost';
import { overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { ScreenSafeAreaView } from '@/shared/ui';
import { colors, darkColors } from '@/theme';
import { useActivity, useActivityDetailStreams } from '../hooks';
import { ActivityDetailCard } from './ActivityDetailCard';
import { ActivityDetailSkeleton } from './ActivityDetailSkeleton';

export interface ActivityDetailScreenContentProps {
  /** The route's opening transition has ended, read by the route that mounted before this */
  transitionSettled: boolean;
}

/**
 * The activity screen's map screen inside its host. An activity with a track is the map filling
 * the window, under the sheet that holds the activity's card or beside its side panel, the map
 * following whichever card is on top. One with no track, an indoor ride or strength without GPS,
 * has no map to show, so the card is drawn as a plain screen and no sheet is presented.
 */
export function ActivityDetailScreenContent({
  transitionSettled,
}: ActivityDetailScreenContentProps) {
  const perfEnd = logScreenRender('ActivityDetailScreen');
  useEffect(() => {
    perfEnd();
  });

  const { id = '', tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { isDark } = useTheme();
  const { data: activity, isLoading } = useActivity(id);
  const { isLoading: streamsLoading, coordinates } = useActivityDetailStreams(id);
  const loading = isLoading || streamsLoading;
  const onMap = !loading && !!activity && coordinates.length > 0;

  // Over the map the status bar draws light; a plain screen takes the theme's.
  const setMapless = useMapSheetHost()?.setMapless;
  const mapless = !loading && !onMap;
  useEffect(() => {
    setMapless?.(mapless);
  }, [setMapless, mapless]);

  // The skeleton stands where the map will be, under the floating header.
  const loadingHeader = useMemo(
    () => (loading ? overMapHeaderOptions({ title: undefined, isDark }) : null),
    [loading, isDark]
  );
  useMapSheetHostHeader(loadingHeader);

  const rootParams = useMemo(() => ({ tab }), [tab]);

  if (loading) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-loading"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ActivityDetailSkeleton activityId={id} />
      </ScreenSafeAreaView>
    );
  }

  if (onMap) {
    return (
      <MapSheetHostMap panel={<DetailCardStack rootParams={rootParams} />}>
        <DetailMapHost rootParams={rootParams} />
      </MapSheetHostMap>
    );
  }

  return (
    <ActivityDetailCard id={id} tab={tab} variant="screen" transitionSettled={transitionSettled} />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfacePage,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
  },
});
