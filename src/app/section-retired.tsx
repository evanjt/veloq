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
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';
import { ledgerDate } from '@/features/routes/lib/sectionLedger';
import { getIntlLocale } from '@/shared/format/format';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

export default function SectionRetiredScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const locale = getIntlLocale();

  const trigger = useEngineSubscription(['sections']);

  const { retired, names } = useMemo(() => {
    const engine = getEngine();
    if (!engine) return { retired: [], names: {} as Record<string, string> };
    return { retired: engine.getRetiredSections(), names: getAllSectionDisplayNames() };
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScreenErrorBoundary screenName="Retired Sections">
      <ScreenSafeAreaView
        hasNativeHeader
        style={[styles.container, isDark && styles.containerDark]}
      >
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
                    <Text style={styles.link}>
                      {t('sectionHistory.retiredInto', { name: names[r.into] ?? r.into })}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  containerDark: { backgroundColor: darkColors.background },
  title: { ...typography.screenTitle, color: colors.textPrimary },
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
  link: { ...typography.bodySmall, color: colors.primary },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  textDark: { color: darkColors.textPrimary },
  textMutedDark: { color: darkColors.textSecondary },
});
