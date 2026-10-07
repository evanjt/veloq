/**
 * The one-time notice that the activity library was rebuilt.
 *
 * A database that cannot be opened or migrated is renamed aside and a fresh one
 * takes its place. The athlete then opens the app to an empty feed, an empty
 * routes tab and a sync starting from nothing, which is indistinguishable from
 * a first install for however long the resync takes. Their sections, the
 * ledger, the pins and the suppressions all came across, and until this card
 * nothing said so. When nothing could be carried across, the card still says
 * the library was rebuilt, without a kept list.
 *
 * An engine open captures the one-shot report, including an open after this
 * notice mounted on the login screen.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useEngineStatus } from '@/features/routes';
import { colors, darkColors, layout, opacity, spacing, typography } from '@/theme';

import { quarantineNoticeParts, type QuarantineNoticeKey } from '../lib/quarantineNotice';
import { clearQuarantineReport } from '../lib/quarantineReport';
import { pressable, pressRipple } from '@/shared/ui';

/**
 * Spelled out rather than built from the key, so the unused-key guard can see
 * every one of them. A template prefix would need an exemption, and the
 * exemption is what stops the guard noticing when one of these is dropped.
 */
const KEPT_KEY = {
  recordings: 'engine.quarantine.kept.recordings',
  routeNames: 'engine.quarantine.kept.routeNames',
  sections: 'engine.quarantine.kept.sections',
  history: 'engine.quarantine.kept.history',
  geometry: 'engine.quarantine.kept.geometry',
  pins: 'engine.quarantine.kept.pins',
  intents: 'engine.quarantine.kept.intents',
} as const satisfies Record<QuarantineNoticeKey, string>;

export function LibraryRebuiltNotice() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const report = useEngineStatus((s) => s.quarantineReport);
  const parts = quarantineNoticeParts(report);
  if (!parts) return null;

  const kept = parts
    .map((part) => t(KEPT_KEY[part.key], { count: part.count }))
    .join(t('engine.quarantine.separator'));
  const keptLine =
    parts.length > 0 ? (
      <Text testID="library-rebuilt-kept" style={styles.body}>
        {t('engine.quarantine.kept.lead', { kept })}
      </Text>
    ) : (
      <Text style={styles.body}>{t('engine.quarantine.keptNothing')}</Text>
    );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={clearQuarantineReport}>
      <View style={styles.overlay}>
        <View testID="library-rebuilt-notice" style={[styles.card, isDark && styles.cardDark]}>
          <MaterialCommunityIcons
            name="database-refresh-outline"
            size={28}
            color={isDark ? darkColors.primary : colors.primary}
          />
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('engine.quarantine.title')}
          </Text>
          {keptLine}
          <Text style={styles.body}>{t('engine.quarantine.resyncing')}</Text>
          <Pressable
            testID="library-rebuilt-dismiss"
            style={pressable(styles.dismiss)}
            android_ripple={pressRipple}
            onPress={clearQuarantineReport}
          >
            <Text style={[styles.dismissText, isDark && { color: darkColors.linkTeal }]}>
              {t('engine.quarantine.dismiss')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: opacity.overlay.scrim,
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  dismiss: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dismissText: {
    ...typography.label,
    color: colors.linkTeal,
  },
});
