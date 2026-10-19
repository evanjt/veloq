import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { DetailCardStack, DetailMapHost } from '@/features/routes';
import { useTheme } from '@/shared/app';
import { MapSheetHostMap, useMapSheetHost, useMapSheetHostHeader } from '@/shared/app/MapSheetHost';
import { overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useActivity, useActivityDetailStreams } from '../hooks';
import { ActivityDetailCard } from './ActivityDetailCard';
import { ActivityDetailLoading } from './ActivityDetailLoading';

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

  // The skeleton stands where the map will be, under the floating header and its back chip.
  const loadingHeader = useMemo(
    () => (loading ? overMapHeaderOptions({ title: undefined, isDark }) : null),
    [loading, isDark]
  );
  useMapSheetHostHeader(loadingHeader);

  const rootParams = useMemo(() => ({ tab }), [tab]);

  if (loading) {
    return (
      <View testID="activity-detail-loading" style={styles.container}>
        <ActivityDetailLoading activityId={id} />
      </View>
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
  },
});
