import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout } from '@/theme';
import { BackupSection } from '@/components/settings';

export default function BackupSettingsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <ScreenErrorBoundary screenName="BackupSettings">
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
              accessibilityLabel={t('common.back')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color={isDark ? colors.textOnDark : colors.textPrimary}
              />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, isDark && styles.textLight]}>
              {t('backup.autoBackup')}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          <BackupSection />
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
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
  content: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
  textLight: {
    color: colors.textOnDark,
  },
});
