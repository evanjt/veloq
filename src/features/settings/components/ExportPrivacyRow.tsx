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
import { HomeRadiusMap, type LngLat } from '@/features/maps';
import { getEngine } from '@/shared/native/engine';
import { engineErrorTag } from '@/shared/native/engineError';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { ExportPrivacyPreview } from 'veloqrs';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { Button, ToggleButtonRow } from '@/shared/ui/Button';
import { Row } from '@/shared/ui/Row';
import { InfoButton } from './InfoButton';

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

/**
 * The guess and the ride count only advise: the trim applies at export
 * whatever they say. A failed read leaves them off the row rather than taking
 * the backup screen around it to its fallback.
 */
function advisory<T>(what: string, read: () => T | null | undefined): T | null {
  try {
    return read() ?? null;
  } catch (error) {
    console.warn(`[ExportPrivacy] Could not ${what}:`, engineErrorTag(error) ?? error);
    return null;
  }
}

/** A whole percentage, never 0 for a share that is not zero. */
export function endpointSharePercent(share: number): number {
  if (!(share > 0)) return 0;
  return Math.min(100, Math.max(1, Math.round(share * 100)));
}

export function ExportPrivacyRow() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Read through, rather than copied into state on mount: what is stored is
  // the truth until the athlete changes it, and the two edits below are the
  // only things that do.
  const engine = useEngineReady();
  const readScreen = useEngineRead(['cutoverSettled']);
  const stored = useMemo(() => {
    const data = readScreen((engine) => engine.getBackupScreenData());
    const lat = data?.homeLat;
    const lng = data?.homeLng;
    const hasHome = Boolean(lat && lng);
    const radius = Number(data?.radiusM ?? '0');
    return {
      hasHome,
      home: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
      radius,
      enabled: radius > 0,
      suggestion: data?.suggestion ?? null,
    };
  }, [readScreen]);

  const [confirmedHome, setConfirmedHome] = useState<LngLat | null>(null);
  const [toggled, setToggled] = useState<boolean | null>(null);

  const [radius, setRadius] = useState<number | null>(null);

  const confirmed = stored.hasHome || confirmedHome !== null;
  const enabled = toggled ?? stored.enabled;
  const suggestion = stored.suggestion;
  const activeRadius = enabled ? (radius ?? stored.radius ?? DEFAULT_RADIUS_M) : 0;

  // The home the preview is measured against: what is stored, or what was just
  // confirmed in this render pass and not yet read back.
  const home = useMemo(() => {
    if (confirmedHome) return { lat: confirmedHome[1], lng: confirmedHome[0] };
    return stored.home;
  }, [stored.home, confirmedHome]);

  // What the map draws: the home if there is one, else the guess on offer. The
  // circle in the off position is what turning it on would cover.
  const mapHome = useMemo<LngLat | null>(() => {
    if (home) return [home.lng, home.lat];
    return suggestion ? [suggestion.longitude, suggestion.latitude] : null;
  }, [home, suggestion]);
  // Off, the row describes and draws the radius the switch would turn back on.
  const mapRadius = activeRadius > 0 ? activeRadius : (radius ?? DEFAULT_RADIUS_M);

  const preview: ExportPrivacyPreview | null = useMemo(() => {
    if (!home || !engine?.exportPrivacyPreview) return null;
    return advisory('preview the trim', () =>
      engine.exportPrivacyPreview(home.lat, home.lng, activeRadius)
    );
  }, [engine, home, activeRadius]);

  // Placing the pin and confirming the guess are the same two writes.
  const handleMove = useCallback((next: LngLat) => {
    const client = getEngine();
    client?.setSetting?.(HOME_LAT_KEY, String(next[1]));
    client?.setSetting?.(HOME_LNG_KEY, String(next[0]));
    setConfirmedHome(next);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!suggestion) return;
    handleMove([suggestion.longitude, suggestion.latitude]);
  }, [suggestion, handleMove]);

  const handleToggle = useCallback(
    (next: boolean) => {
      // A radius with no home trims nothing, so the switch does not move until
      // there is one. Off is a zero radius, which is the engine's own off.
      if (!confirmed) return;
      const client = getEngine();
      if (!client) return;
      const next_m = next ? mapRadius : 0;
      client.setSetting?.(RADIUS_KEY, String(next_m));
      setToggled(next);
      if (next) setRadius(next_m);
    },
    [confirmed, mapRadius]
  );

  const handleRadius = useCallback((metres: number) => {
    const client = getEngine();
    if (!client) return;
    client.setSetting?.(RADIUS_KEY, String(metres));
    setRadius(metres);
    setToggled(true);
  }, []);

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const hint = [styles.hint, isDark && settingsStyles.textMuted];

  return (
    <View style={styles.block} testID="export-privacy-row">
      <Row>
        <MaterialCommunityIcons name="home-map-marker" size={22} color={textSecondary} />
        <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
          {t('settings.exportPrivacyTitle', 'Leave home out of exports')}
        </Text>
        <InfoButton
          testID="export-privacy-info"
          title={t('settings.exportPrivacyTitle', 'Leave home out of exports')}
          message={[
            t('settings.exportPrivacyDescription', {
              defaultValue:
                'Trims the start and end of each track within {{radius}} m of home. Only the exported copy is shortened.',
              radius: mapRadius,
            }),
            t('settings.exportPrivacyMoveHint', 'Tap the map to move home.'),
          ].join('\n\n')}
        />
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={!confirmed}
          color={colors.primary}
          testID="export-privacy-switch"
        />
      </Row>

      {mapHome && (
        <View style={styles.indented}>
          <HomeRadiusMap
            home={mapHome}
            radiusM={mapRadius}
            onMove={handleMove}
            testID="export-privacy-map"
          />
        </View>
      )}

      {!confirmed && suggestion && (
        <View style={[styles.indented, styles.suggestion]} testID="export-privacy-home">
          <Text style={[hint, styles.suggestionText]}>
            {t('settings.exportPrivacySuggested', {
              defaultValue:
                'Most of your rides start near one place, {{count}} of them. {{share}}% of all ride ends.',
              count: suggestion.activityCount,
              share: endpointSharePercent(suggestion.endpointShare),
            })}
          </Text>
          <Button
            testID="export-privacy-confirm"
            label={t('settings.exportPrivacyConfirm', 'Use it as home')}
            variant="secondary"
            size="sm"
            onPress={handleConfirm}
          />
        </View>
      )}

      {confirmed && preview && (
        <Text style={[hint, styles.indented]} testID="export-privacy-count">
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
        <View style={styles.indented} testID="export-privacy-radius">
          <ToggleButtonRow
            value={String(activeRadius)}
            onValueChange={(value) => handleRadius(Number(value))}
            options={RADIUS_CHOICES_M.map((metres) => ({
              value: String(metres),
              testID: `export-privacy-radius-${metres}`,
              label: t('settings.exportPrivacyRadius', {
                defaultValue: '{{metres}} m',
                metres,
              }),
            }))}
          />
        </View>
      )}

      {!confirmed && !suggestion && (
        <Text style={[hint, styles.indented]} testID="export-privacy-no-home">
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
  block: { paddingBottom: spacing.sm, gap: spacing.sm },
  hint: { ...typography.caption, color: colors.textSecondary },
  indented: { paddingHorizontal: spacing.md },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionText: { flex: 1 },
});
