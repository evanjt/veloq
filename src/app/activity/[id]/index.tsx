import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import {
  ActivityDetailLoading,
  loadActivityDetailScreenContent,
  type ActivityDetailScreenContentProps,
} from '@/features/activity';

function ActivityDetailFirstFrame() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [Content, setContent] =
    useState<React.ComponentType<ActivityDetailScreenContentProps> | null>(null);
  const [posterSettled, setPosterSettled] = useState(false);
  const onPosterSettled = useCallback(() => setPosterSettled(true), []);
  // The content mounts after the preview, often once the transition has ended,
  // so the route reads the transition and hands the content the result.
  const [transitionSettled, setTransitionSettled] = useState(false);
  useAfterNavigationTransition(useCallback(() => setTransitionSettled(true), []));

  useEffect(() => {
    const fallback = setTimeout(onPosterSettled, 250);
    return () => clearTimeout(fallback);
  }, [onPosterSettled]);

  useEffect(() => {
    if (!posterSettled) return undefined;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const ActivityDetailScreenContent = loadActivityDetailScreenContent();
        setContent(() => ActivityDetailScreenContent);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [posterSettled]);

  if (Content) return <Content transitionSettled={transitionSettled} />;

  return (
    <View testID="activity-detail-screen" style={styles.container}>
      <ActivityDetailLoading
        activityId={id || ''}
        onPreviewSettled={onPosterSettled}
        animated={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default withScreenBoundary(ActivityDetailFirstFrame, 'ActivityDetail');
