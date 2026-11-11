import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { goBack } from '@/shared/app/navigation';
import { colors, darkColors, spacing } from '@/theme';
import { ExperimentalOnly, LinkedDevices } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function LinkedDevicesScreenContent() {
  const { isDark } = useTheme();

  return (
    <ExperimentalOnly feature="remoteLink" fallback={<LeaveLinkedDevices />}>
      <ScreenSafeAreaView
        testID="linked-devices-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ScreenScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
          <LinkedDevices />
        </ScreenScrollView>
      </ScreenSafeAreaView>
    </ExperimentalOnly>
  );
}

/** A link that reaches the screen while its switch is off leaves at once, headerless. */
function LeaveLinkedDevices() {
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

export default withScreenBoundary(LinkedDevicesScreenContent, 'LinkedDevices');
