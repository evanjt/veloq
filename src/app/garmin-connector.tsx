import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { goBack } from '@/shared/app/navigation';
import { colors, darkColors, spacing } from '@/theme';
import { ExperimentalOnly, GarminConnector } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function GarminConnectorScreenContent() {
  const { isDark } = useTheme();

  return (
    <ExperimentalOnly feature="garminUpdate" fallback={<LeaveConnector />}>
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <ScreenScrollView
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xl }}
        >
          <GarminConnector />
        </ScreenScrollView>
      </ScreenSafeAreaView>
    </ExperimentalOnly>
  );
}

/** A link that reaches the connector while Garmin's switch is off leaves at once, headerless. */
function LeaveConnector() {
  useEffect(() => {
    goBack();
  }, []);
  return <Stack.Screen options={{ headerShown: false }} />;
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

export default withScreenBoundary(GarminConnectorScreenContent, 'GarminConnector');
