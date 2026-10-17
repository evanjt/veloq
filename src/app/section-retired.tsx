/**
 * Retired sections: the ones the detector dropped, with how each left and
 * the survivor that took its ground. The ledger keeps them; the catalogue
 * does not.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { Card, EmptyState, ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useEngineRead, useEngineReadState } from '@/shared/native/useEngineSubscription';
import { EngineReadPlaceholder } from '@/shared/app/EngineUnavailableState';
import { getAllSectionDisplayNames, ledgerDate } from '@/features/routes';
import { formatDistance, formatFullDate } from '@/shared/format/format';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { navigateTo } from '@/shared/app/navigation';

function SectionRetiredScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

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
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView
        contentContainerStyle={[styles.content, { paddingBottom: layout.screenPadding }]}
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
            const kind = t(`sectionHistory.kind_${r.kind}` as never);
            const distance =
              r.distanceMeters != null && r.distanceMeters > 0
                ? ` · ${formatDistance(r.distanceMeters, isMetric)}`
                : '';
            // The name leads so two retirements of one kind can be told apart;
            // how it left drops to the meta line.
            const body = (
              <>
                <Text numberOfLines={2} style={[styles.title, isDark && styles.textDark]}>
                  {r.name ?? kind}
                </Text>
                {r.name ? (
                  <Text style={[styles.meta, isDark && styles.textSecondaryDark]}>{kind}</Text>
                ) : null}
                <Text style={[styles.meta, isDark && styles.textSecondaryDark]}>
                  {formatFullDate(ledgerDate(r.at))}
                  {distance}
                  {` · ${t('sectionHistory.versions')}: ${r.versions.length}`}
                </Text>
                {into ? (
                  <Text style={[styles.link, isDark && { color: darkColors.actionLink }]}>
                    {into}
                  </Text>
                ) : null}
              </>
            );
            // A retirement merged into another section opens it from anywhere on
            // the card, named by the link, rather than from one line of small text.
            return into ? (
              <Pressable
                key={r.sectionId}
                testID={`section-retired-${r.sectionId}`}
                onPress={() => navigateTo(`/section/${r.into}`)}
                accessibilityRole="link"
                accessibilityLabel={into}
                android_ripple={pressRipple}
                style={pressable(styles.target)}
              >
                <Card variant="flat" style={{ gap: spacing.xs }}>
                  {body}
                </Card>
              </Pressable>
            ) : (
              <Card
                key={r.sectionId}
                variant="flat"
                style={{ gap: spacing.xs }}
                testID={`section-retired-${r.sectionId}`}
              >
                {body}
              </Card>
            );
          })
        )}
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfacePage },
  containerDark: { backgroundColor: darkColors.surfacePage },
  content: {
    padding: layout.screenPadding,
    gap: spacing.sm,
  },
  target: { minHeight: layout.minTapTarget },
  title: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.actionLink },
  textDark: { color: darkColors.textPrimary },
  textSecondaryDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(SectionRetiredScreenContent, 'Retired Sections');
