/**
 * Retired sections: the ones the detector dropped, with how each left and
 * the survivor that took its ground. The ledger keeps them; the catalogue
 * does not.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  FitText,
  NameText,
  ScreenSafeAreaView,
  ScreenScrollView,
} from '@/shared/ui';
import { chooseAction } from '@/shared/ui/dialog';
import { PressTarget } from '@/shared/ui/PressTarget';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useEngineRead, useEngineReadState } from '@/shared/native/useEngineSubscription';
import { EngineReadPlaceholder } from '@/shared/app/EngineUnavailableState';
import { getAllSectionDisplayNames, useRetiredMapData, useSectionLedger } from '@/features/routes';
import { formatDistance } from '@/shared/format/format';
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

  const { data: retiredMap, failure } = useRetiredMapData();
  const engineState = useEngineReadState();

  // The list is the accessible form of the retired map, so it reads what the
  // map reads and the two cannot disagree about which sections left.
  const retired = useMemo(() => retiredMap?.retired.map((r) => r.section) ?? [], [retiredMap]);
  const readNames = useEngineRead(['sections', 'detectionApplied']);
  const names = useMemo(
    () => readNames(() => getAllSectionDisplayNames()) ?? ({} as Record<string, string>),
    [readNames]
  );

  // A failed read is not an empty ledger: it goes to the screen's fallback.
  if (failure) throw failure.error;

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
              const distance =
                r.distanceMeters != null && r.distanceMeters > 0
                  ? formatDistance(r.distanceMeters, isMetric)
                  : null;
              const title = r.name ?? t('sectionHistory.pairUnnamed');
              const detail = [distance, into].filter(Boolean).join(' · ');
              const restorable = r.restorableVersion != null ? Number(r.restorableVersion) : null;
              // The row is one line and opens the old-versus-new map on its section, so
              // the athlete sees where it was. Restore sits beside it when it has a version.
              return (
                <View key={r.sectionId} style={styles.row}>
                  <PressTarget
                    testID={`section-retired-${r.sectionId}`}
                    onPress={() =>
                      navigateTo({
                        pathname: '/detection-preview',
                        params: { layer: 'retired', retired: r.sectionId },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={[title, detail].filter(Boolean).join(', ')}
                    style={styles.target}
                  >
                    <View style={styles.line}>
                      <NameText style={[styles.title, styles.lineTitle, isDark && styles.textDark]}>
                        {title}
                      </NameText>
                      {detail ? (
                        <FitText
                          style={[
                            styles.meta,
                            styles.lineDetail,
                            isDark && styles.textSecondaryDark,
                          ]}
                        >
                          {detail}
                        </FitText>
                      ) : null}
                    </View>
                  </PressTarget>
                  {restorable != null ? (
                    <RestoreAction sectionId={r.sectionId} version={restorable} name={title} />
                  ) : null}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  lineTitle: { flexShrink: 1 },
  lineDetail: { flexShrink: 2 },
  target: { flex: 1, minHeight: layout.minTapTarget, justifyContent: 'center' },
  title: { ...typography.body, color: colors.textPrimary },
  intro: { ...typography.bodySmall, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textSecondary },
  textDark: { color: darkColors.textPrimary },
  textSecondaryDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(SectionRetiredScreenContent, 'Retired Sections');
