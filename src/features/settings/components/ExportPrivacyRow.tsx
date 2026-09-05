/**
 * How much of a track around home a bulk export leaves behind.
 *
 * The engine trims the ends of a track around a configured home and does
 * nothing without one, so this row is the only thing that turns the protection
 * on. The home is offered rather than assumed: the densest cluster of track
 * endpoints is a good guess and not an answer, and a trim aimed at the wrong
 * place protects nothing while looking as though it does.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import type { SuggestedHome } from 'veloqrs';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

const HOME_LAT_KEY = '__export_home_lat';
const HOME_LNG_KEY = '__export_home_lng';
const RADIUS_KEY = '__export_privacy_radius_m';

/** Measured: 100 m touches 2 sections of 177 and dissolves none. */
const DEFAULT_RADIUS_M = 100;

export function ExportPrivacyRow() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Read through, rather than copied into state on mount: what is stored is
  // the truth until the athlete changes it, and the two edits below are the
  // only things that do.
  const engine = useEngineReady();
  const stored = useMemo(() => {
    const lat = engine?.getSetting?.(HOME_LAT_KEY);
    const lng = engine?.getSetting?.(HOME_LNG_KEY);
    const hasHome = Boolean(lat && lng);
    return {
      hasHome,
      enabled: Number(engine?.getSetting?.(RADIUS_KEY) ?? '0') > 0,
      suggestion: hasHome
        ? null
        : ((engine?.suggestExportHome?.() ?? null) as SuggestedHome | null),
    };
  }, [engine]);

  const [confirmedHome, setConfirmedHome] = useState<SuggestedHome | null>(null);
  const [toggled, setToggled] = useState<boolean | null>(null);

  const confirmed = stored.hasHome || confirmedHome !== null;
  const enabled = toggled ?? stored.enabled;
  const suggestion = stored.suggestion;

  const handleConfirm = useCallback(() => {
    if (!suggestion) return;
    const client = getEngine();
    client?.setSetting?.(HOME_LAT_KEY, String(suggestion.latitude));
    client?.setSetting?.(HOME_LNG_KEY, String(suggestion.longitude));
    setConfirmedHome(suggestion);
  }, [suggestion]);

  const handleToggle = useCallback(
    (next: boolean) => {
      // A radius with no home trims nothing, so the switch does not move until
      // there is one. Off is a zero radius, which is the engine's own off.
      if (!confirmed) return;
      const client = getEngine();
      if (!client) return;
      client.setSetting?.(RADIUS_KEY, next ? String(DEFAULT_RADIUS_M) : '0');
      setToggled(next);
    },
    [confirmed]
  );

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.block} testID="export-privacy-row">
      <View style={settingsStyles.actionRow}>
        <MaterialCommunityIcons name="home-map-marker" size={22} color={textSecondary} />
        <View style={styles.textWrap}>
          <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
            {t('settings.exportPrivacyTitle', 'Leave home out of exports')}
          </Text>
          <Text style={[styles.hint, isDark && settingsStyles.textMuted]}>
            {t(
              'settings.exportPrivacyDescription',
              'Trims the start and end of each track within 100 m of home. Only the exported copy is shortened.'
            )}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={!confirmed}
          color={colors.primary}
          testID="export-privacy-switch"
        />
      </View>

      {!confirmed && suggestion && (
        <View style={styles.homeRow} testID="export-privacy-home">
          <Text style={[styles.hint, isDark && settingsStyles.textMuted]}>
            {t('settings.exportPrivacySuggested', {
              defaultValue: 'Most of your rides start near one place, {{count}} of them.',
              count: suggestion.activityCount,
            })}
          </Text>
          <Text
            style={[styles.confirm, { color: colors.primary }]}
            onPress={handleConfirm}
            testID="export-privacy-confirm"
          >
            {t('settings.exportPrivacyConfirm', 'Use it as home')}
          </Text>
        </View>
      )}

      {!confirmed && !suggestion && (
        <Text
          style={[styles.hint, styles.homeRow, isDark && settingsStyles.textMuted]}
          testID="export-privacy-no-home"
        >
          {t(
            'settings.exportPrivacyNoSuggestion',
            'Not enough rides yet to work out where home is.'
          )}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { paddingBottom: spacing.sm },
  textWrap: { flex: 1, marginLeft: spacing.sm },
  hint: { ...typography.caption, color: colors.textSecondary },
  homeRow: { paddingHorizontal: spacing.md, gap: spacing.xs },
  confirm: { ...typography.caption, fontWeight: '600' },
});
