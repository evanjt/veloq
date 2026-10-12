/**
 * Retired sections: the ones the detector dropped, with how each left and
 * the survivor that took its ground. The ledger keeps them; the catalogue
 * does not.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { EmptyState, ScreenSafeAreaView, ScreenScrollView, useTabBarClearance } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useEngineRead, useEngineReadState } from '@/shared/native/useEngineSubscription';
import { EngineReadPlaceholder } from '@/shared/app/EngineUnavailableState';
import { getAllSectionDisplayNames, ledgerDate } from '@/features/routes';
import { getIntlLocale } from '@/shared/format/format';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { tapTo } from '@/shared/app/navigation';

function SectionRetiredScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();
  const locale = getIntlLocale();

  const readRetired = useEngineRead(['sections', 'detectionApplied']);
  const engineState = useEngineReadState();

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
      <ScreenScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: layout.screenPadding + tabBarClearance },
        ]}
        testID="section-retired-list"
      >
        {engineState !== 'ready' ? (
          <EngineReadPlaceholder state={engineState} />
        ) : retired.length === 0 ? (
          <EmptyState icon="archive-outline" title={t('sectionHistory.retiredEmpty')} />
        ) : (
          retired.map((r) => {
            const into = r.into
              ? t('sectionHistory.retiredInto', { name: names[r.into] ?? r.into })
              : null;
            const body = (
              <>
                <Text style={[styles.kind, isDark && styles.textDark]}>
                  {t(`sectionHistory.kind_${r.kind}` as never)}
                </Text>
                <Text style={[styles.meta, isDark && styles.textSecondaryDark]}>
                  {ledgerDate(r.at).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {` · ${t('sectionHistory.versions')}: ${r.versions.length}`}
                </Text>
                {into && (
                  <Text style={[styles.link, isDark && { color: darkColors.linkTeal }]}>
                    {into}
                  </Text>
                )}
              </>
            );
            // A retirement merged into another section opens it from anywhere on
            // the card, named by the link, rather than from one line of small text.
            return into ? (
              <Pressable
                key={r.sectionId}
                testID={`section-retired-${r.sectionId}`}
                onPress={() => tapTo(`/section/${r.into}`)}
                accessibilityRole="link"
                accessibilityLabel={into}
                android_ripple={pressRipple}
                style={pressable([styles.card, isDark && styles.cardDark])}
              >
                {body}
              </Pressable>
            ) : (
              <View
                key={r.sectionId}
                style={[styles.card, isDark && styles.cardDark]}
                testID={`section-retired-${r.sectionId}`}
              >
                {body}
              </View>
            );
          })
        )}
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  containerDark: { backgroundColor: darkColors.background },
  content: {
    padding: layout.screenPadding,
    gap: spacing.sm,
  },
  card: {
    minHeight: layout.minTapTarget,
    padding: layout.cardPadding,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  cardDark: { backgroundColor: darkColors.surface },
  kind: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.linkTeal },
  textDark: { color: darkColors.textPrimary },
  textSecondaryDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(SectionRetiredScreenContent, 'Retired Sections');
