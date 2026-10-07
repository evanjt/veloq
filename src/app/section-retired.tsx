/**
 * Retired sections: the ones the detector dropped, with how each left and
 * the survivor that took its ground. The ledger keeps them; the catalogue
 * does not.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { getAllSectionDisplayNames, ledgerDate } from '@/features/routes';
import { getIntlLocale } from '@/shared/format/format';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function SectionRetiredScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const locale = getIntlLocale();

  const readRetired = useEngineRead(['sections', 'detectionApplied']);

  const { retired, names } = useMemo(
    () =>
      readRetired((engine) => ({
        retired: engine.getRetiredSections(),
        names: getAllSectionDisplayNames(),
      })) ?? { retired: [], names: {} as Record<string, string> },
    [readRetired]
  );

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.content} testID="section-retired-list">
        {retired.length === 0 ? (
          <Text style={[styles.empty, isDark && styles.textMutedDark]}>
            {t('sectionHistory.retiredEmpty')}
          </Text>
        ) : (
          retired.map((r) => (
            <View
              key={r.sectionId}
              style={[styles.card, isDark && styles.cardDark]}
              testID={`section-retired-${r.sectionId}`}
            >
              <Text style={[styles.kind, isDark && styles.textDark]}>
                {t(`sectionHistory.kind_${r.kind}` as never)}
              </Text>
              <Text style={[styles.meta, isDark && styles.textMutedDark]}>
                {ledgerDate(r.at).toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {` · ${t('sectionHistory.versions')}: ${r.versions.length}`}
              </Text>
              {r.into && (
                <TouchableOpacity
                  testID={`section-retired-${r.sectionId}-into`}
                  onPress={() => router.push(`/section/${r.into}`)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.link, isDark && { color: darkColors.linkTeal }]}>
                    {t('sectionHistory.retiredInto', { name: names[r.into] ?? r.into })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  containerDark: { backgroundColor: darkColors.background },
  content: { padding: layout.screenPadding, paddingBottom: TAB_BAR_SAFE_PADDING, gap: spacing.sm },
  card: {
    padding: layout.cardPadding,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  cardDark: { backgroundColor: darkColors.surface },
  kind: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.linkTeal },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  textDark: { color: darkColors.textPrimary },
  textMutedDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(SectionRetiredScreenContent, 'Retired Sections');
