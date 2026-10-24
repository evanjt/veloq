/**
 * Retired sections: the ones the detector dropped, with how each left and
 * the survivor that took its ground. The ledger keeps them; the catalogue
 * does not.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { chooseAction } from '@/shared/ui/dialog';
import { PressTarget } from '@/shared/ui/PressTarget';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useEngineRead, useEngineReadState } from '@/shared/native/useEngineSubscription';
import { EngineReadPlaceholder } from '@/shared/app/EngineUnavailableState';
import { getAllSectionDisplayNames, ledgerDate, useSectionLedger } from '@/features/routes';
import { formatDistance, formatFullDate } from '@/shared/format/format';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { navigateTo } from '@/shared/app/navigation';

/**
 * Restore for one retired card. The engine names the version it can restore
 * from; the card offers the action only when it did. Once restored the card
 * leaves the list on the engine's `sections` event and a notice offers Open.
 */
function RestoreAction({
  sectionId,
  version,
  name,
}: {
  sectionId: string;
  version: number;
  name: string;
}) {
  const { t } = useTranslation();
  const { revert, isReverting } = useSectionLedger(sectionId);

  const restore = async () => {
    if (!(await revert(version))) return;
    chooseAction({
      title: t('sectionHistory.restoredTitle'),
      message: name,
      cancelLabel: t('common.close'),
      actions: [
        { label: t('sections.attemptOpen'), onPress: () => navigateTo(`/section/${sectionId}`) },
      ],
    });
  };

  return (
    <Button
      testID={`section-retired-restore-${sectionId}`}
      label={t('common.restore')}
      variant="secondary"
      size="sm"
      loading={isReverting}
      onPress={restore}
    />
  );
}

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
          <>
            <Text
              testID="section-retired-intro"
              style={[styles.intro, isDark && styles.textSecondaryDark]}
            >
              {t('sectionHistory.retiredIntro')}
            </Text>
            {retired.map((r) => {
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
              const restorable = r.restorableVersion != null ? Number(r.restorableVersion) : null;
              const card = into ? (
                <PressTarget
                  key={r.sectionId}
                  testID={`section-retired-${r.sectionId}`}
                  onPress={() => navigateTo(`/section/${r.into}`)}
                  accessibilityRole="link"
                  accessibilityLabel={into}
                  style={styles.target}
                >
                  <Card variant="flat" style={{ gap: spacing.xs }}>
                    {body}
                  </Card>
                </PressTarget>
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
              if (restorable == null) return card;
              return (
                <View key={r.sectionId} style={{ gap: spacing.xs }}>
                  {card}
                  <RestoreAction
                    sectionId={r.sectionId}
                    version={restorable}
                    name={r.name ?? kind}
                  />
                </View>
              );
            })}
          </>
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
  intro: { ...typography.bodySmall, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.actionLink },
  textDark: { color: darkColors.textPrimary },
  textSecondaryDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(SectionRetiredScreenContent, 'Retired Sections');
