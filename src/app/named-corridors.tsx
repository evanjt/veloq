/**
 * The names a user gave to sections. A name is keyed to ground, not to a
 * section id, so it survives a re-cut and goes dormant when nothing visible
 * covers that ground. This screen is the only place a name can be seen as a
 * name, and the only place one can be taken back.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { useTranslation } from 'react-i18next';
import {
  Card,
  EmptyState,
  IconButton,
  ScreenSafeAreaView,
  ScreenScrollView,
  PressTarget,
  TrackPreview,
  normaliseTrackPoints,
} from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { EngineReadPlaceholder } from '@/shared/app/EngineUnavailableState';
import {
  useNamedCorridors,
  type NamedCorridor,
  useSectionDisplayNames,
  ledgerDate,
} from '@/features/routes';
import { formatFullDate } from '@/shared/format/format';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { navigateTo } from '@/shared/app/navigation';
import { confirmAction } from '@/shared/ui/dialog';

const PREVIEW_WIDTH = 64;
const PREVIEW_HEIGHT = 44;

function FootprintPreview({
  footprint,
  isDark,
}: {
  footprint: NamedCorridor['footprint'];
  isDark: boolean;
}) {
  const points = useMemo(
    () => normaliseTrackPoints(footprint.map((p) => ({ lat: p.latitude, lng: p.longitude }))),
    [footprint]
  );
  return (
    <TrackPreview points={points} isDark={isDark} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
  );
}

function NamedCorridorsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { corridors, state, remove } = useNamedCorridors();

  const sectionNames = useSectionDisplayNames();

  const onSection = (corridor: NamedCorridor) =>
    t('namedCorridors.onSection', {
      name: sectionNames[corridor.sectionId ?? ''] ?? corridor.sectionId,
      percent: Math.round(corridor.coverage * 100),
    });

  const confirmRemove = (corridor: NamedCorridor) => {
    confirmAction({
      title: t('namedCorridors.deleteTitle'),
      message: t('namedCorridors.deleteConfirm', { name: corridor.name }),
      confirmLabel: t('namedCorridors.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => remove(corridor.intentId),
    });
  };

  return (
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView
        contentContainerStyle={[styles.content, { paddingBottom: layout.screenPadding }]}
        testID="named-corridors-list"
      >
        {state !== 'ready' ? (
          <EngineReadPlaceholder state={state} />
        ) : corridors.length === 0 ? (
          <EmptyState
            testID="named-corridors-empty"
            icon="map-marker-path"
            title={t('namedCorridors.empty')}
          />
        ) : (
          corridors.map((corridor) => {
            const details = (
              <>
                <Text style={[styles.name, isDark && styles.textDark]}>{corridor.name}</Text>
                <Text style={[styles.meta, isDark && styles.textSecondaryDark]}>
                  {t('namedCorridors.created', {
                    date: formatFullDate(ledgerDate(corridor.createdAt)),
                  })}
                </Text>
                {corridor.dormant ? (
                  <Text
                    testID={`named-corridor-${corridor.intentId}-dormant`}
                    style={[styles.meta, isDark && styles.textSecondaryDark]}
                  >
                    {t('namedCorridors.dormant')}
                  </Text>
                ) : (
                  <Text style={[styles.link, isDark && { color: darkColors.actionLink }]}>
                    {onSection(corridor)}
                  </Text>
                )}
                {!corridor.dormant && !corridor.primary && (
                  <Text
                    testID={`named-corridor-${corridor.intentId}-secondary`}
                    style={[styles.meta, isDark && styles.textSecondaryDark]}
                  >
                    {t('namedCorridors.secondary')}
                  </Text>
                )}
              </>
            );
            return (
              <Card
                key={corridor.intentId}
                variant="flat"
                testID={`named-corridor-${corridor.intentId}`}
              >
                <View style={styles.row}>
                  <FootprintPreview footprint={corridor.footprint} isDark={isDark} />
                  {corridor.dormant ? (
                    <View style={styles.body}>{details}</View>
                  ) : (
                    // The text beside the footprint opens the section, named by the
                    // link line, so the target is the block and not one line of it.
                    <PressTarget
                      testID={`named-corridor-${corridor.intentId}-open`}
                      onPress={() => navigateTo(`/section/${corridor.sectionId}`)}
                      style={styles.body}
                      accessibilityRole="link"
                      accessibilityLabel={onSection(corridor)}
                    >
                      {details}
                    </PressTarget>
                  )}
                  <IconButton
                    testID={`named-corridor-${corridor.intentId}-delete`}
                    onPress={() => confirmRemove(corridor)}
                    accessibilityLabel={t('namedCorridors.delete')}
                  >
                    <ChromeIcon name="delete" size={iconSize.md} color={colors.errorText} />
                  </IconButton>
                </View>
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
  content: { padding: layout.screenPadding, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  body: { flex: 1, gap: spacing.xs, minHeight: layout.minTapTarget },
  name: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.actionLink },
  textDark: { color: darkColors.textPrimary },
  textSecondaryDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(NamedCorridorsScreenContent, 'Named Corridors');
