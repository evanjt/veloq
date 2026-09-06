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
import type { SuggestedHome, ExportPrivacyPreview } from 'veloqrs';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

const HOME_LAT_KEY = '__export_home_lat';
const HOME_LNG_KEY = '__export_home_lng';
const RADIUS_KEY = '__export_privacy_radius_m';

/** Measured: 100 m touches 2 sections of 177 and dissolves none. */
const DEFAULT_RADIUS_M = 100;

/**
 * The radii offered. Metres alone say nothing, so each one is shown with the
 * number of rides it reaches, which is what makes the choice concrete.
 */
const RADIUS_CHOICES_M = [100, 250, 500] as const;

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

  const [radius, setRadius] = useState<number | null>(null);

  const confirmed = stored.hasHome || confirmedHome !== null;
  const enabled = toggled ?? stored.enabled;
  const suggestion = stored.suggestion;
  const storedRadius = Number(engine?.getSetting?.(RADIUS_KEY) ?? '0');
  const activeRadius = enabled ? (radius ?? storedRadius ?? DEFAULT_RADIUS_M) : 0;

  // The home the preview is measured against: what is stored, or what was just
  // confirmed in this render pass and not yet read back.
  const home = useMemo(() => {
    if (confirmedHome) return { lat: confirmedHome.latitude, lng: confirmedHome.longitude };
    const lat = Number(engine?.getSetting?.(HOME_LAT_KEY));
    const lng = Number(engine?.getSetting?.(HOME_LNG_KEY));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [engine, confirmedHome]);

  const preview: ExportPrivacyPreview | null = useMemo(() => {
    if (!home || !engine?.exportPrivacyPreview) return null;
    return engine.exportPrivacyPreview(home.lat, home.lng, activeRadius);
  }, [engine, home, activeRadius]);

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
      const next_m = next ? (radius ?? DEFAULT_RADIUS_M) : 0;
      client.setSetting?.(RADIUS_KEY, String(next_m));
      setToggled(next);
      if (next) setRadius(next_m);
    },
    [confirmed, radius]
  );

  const handleRadius = useCallback((metres: number) => {
    const client = getEngine();
    if (!client) return;
    client.setSetting?.(RADIUS_KEY, String(metres));
    setRadius(metres);
    setToggled(true);
  }, []);

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

      {confirmed && preview && (
        <Text
          style={[styles.hint, styles.homeRow, isDark && settingsStyles.textMuted]}
          testID="export-privacy-count"
        >
          {enabled
            ? t('settings.exportPrivacyCount', {
                defaultValue:
                  'Shortens {{touched}} of {{total}} rides at {{radius}} m. Nothing is deleted.',
                touched: preview.touched,
                total: preview.withTrack,
                radius: activeRadius,
              })
            : t(
                'settings.exportPrivacyNothingTrimmed',
                'Nothing is trimmed. Exports carry the full track.'
              )}
        </Text>
      )}

      {confirmed && enabled && (
        <View style={styles.radiusRow} testID="export-privacy-radius">
          {RADIUS_CHOICES_M.map((metres) => (
            <Text
              key={metres}
              onPress={() => handleRadius(metres)}
              testID={`export-privacy-radius-${metres}`}
              style={[
                styles.radiusChip,
                isDark && settingsStyles.textMuted,
                metres === activeRadius && { color: colors.primary, fontWeight: '600' },
              ]}
            >
              {t('settings.exportPrivacyRadius', {
                defaultValue: '{{metres}} m',
                metres,
              })}
            </Text>
          ))}
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
  radiusRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md },
  radiusChip: { ...typography.caption, color: colors.textSecondary },
});
