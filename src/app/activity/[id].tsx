import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/shared/app';
import { ScreenSafeAreaView } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { ActivityDetailSkeleton, loadActivityDetailScreenContent } from '@/features/activity';
import { colors, darkColors } from '@/theme';

function ActivityDetailFirstFrame() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark } = useTheme();
  const [Content, setContent] = useState<React.ComponentType | null>(null);
  const [posterSettled, setPosterSettled] = useState(false);
  const onPosterSettled = useCallback(() => setPosterSettled(true), []);

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

  if (Content) return <Content />;

  return (
    <ScreenSafeAreaView
      testID="activity-detail-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <ActivityDetailSkeleton
        activityId={id || ''}
        onPosterSettled={onPosterSettled}
        animated={false}
      />
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
});

export default withScreenBoundary(ActivityDetailFirstFrame, 'ActivityDetail');
