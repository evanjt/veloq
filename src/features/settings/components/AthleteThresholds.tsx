import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@/shared/app';
import { ListSectionHeader, TextField } from '@/shared/ui';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import {
  FfiThresholdField,
  FfiThresholdSource,
  type FfiSportThresholds,
  type FfiThresholdFigure,
} from 'veloqrs';
import { useThresholdsScreen } from '../hooks/useThresholdsScreen';
import { readThresholdEntry } from '../lib/thresholdEntry';
import { settingsStyles } from './settingsStyles';

function fieldLabel(t: TFunction, field: FfiThresholdField): string {
  switch (field) {
    case FfiThresholdField.Ftp:
      return t('thresholds.fields.ftp');
    case FfiThresholdField.ThresholdHr:
      return t('thresholds.fields.thresholdHr');
    case FfiThresholdField.MaxHr:
      return t('thresholds.fields.maxHr');
    case FfiThresholdField.RestingHr:
      return t('thresholds.fields.restingHr');
    default:
      return t('thresholds.fields.weightKg');
  }
}

function fieldUnit(field: FfiThresholdField): string {
  switch (field) {
    case FfiThresholdField.Ftp:
      return 'W';
    case FfiThresholdField.WeightKg:
      return 'kg';
    default:
      return 'bpm';
  }
}

function sourceHint(t: TFunction, source: FfiThresholdSource, value: number): string {
  switch (source) {
    case FfiThresholdSource.Athlete:
      return t('thresholds.source.athlete', { value });
    case FfiThresholdSource.SportSettings:
      return t('thresholds.source.sportSettings', { value });
    default:
      return t('thresholds.source.file', { value });
  }
}

function sportTitle(t: TFunction, sport: string): string {
  if (sport === 'Ride') return t('thresholds.cycling');
  if (sport === 'Run') return t('thresholds.running');
  return sport;
}

interface FigureFieldProps {
  sport: string;
  figure: FfiThresholdFigure;
  setFigure: (sport: string, field: FfiThresholdField, value: number | null) => Promise<void>;
}

function FigureField({ sport, figure, setFigure }: FigureFieldProps) {
  const { t } = useTranslation();
  const athleteValue = figure.source === FfiThresholdSource.Athlete ? (figure.value ?? null) : null;
  const [text, setText] = useState(athleteValue === null ? '' : String(athleteValue));
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    const entry = readThresholdEntry(text, athleteValue);
    if (entry.kind === 'unchanged') {
      setError(null);
      return;
    }
    if (entry.kind === 'invalid') {
      setError(t('thresholds.invalid'));
      return;
    }
    try {
      await setFigure(sport, figure.field, entry.kind === 'set' ? entry.value : null);
      setError(null);
      if (entry.kind === 'clear') setText('');
    } catch {
      setError(t('thresholds.invalid'));
    }
  };

  const hint =
    figure.value == null || figure.source == null
      ? t('thresholds.notSet')
      : sourceHint(t, figure.source, figure.value);

  return (
    <TextField
      label={fieldLabel(t, figure.field)}
      unit={fieldUnit(figure.field)}
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="decimal-pad"
      hint={hint}
      error={error}
      placeholder={figure.value == null ? undefined : String(figure.value)}
      testID={`threshold-${sport}-${FfiThresholdField[figure.field]}`}
    />
  );
}

function SportThresholds({
  sport,
  setFigure,
}: {
  sport: FfiSportThresholds;
  setFigure: FigureFieldProps['setFigure'];
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  return (
    <>
      <ListSectionHeader testID={`threshold-group-${sport.sport}`}>
        {sportTitle(t, sport.sport)}
      </ListSectionHeader>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <View style={styles.group}>
          {sport.figures.map((figure) => (
            <FigureField
              key={figure.field}
              sport={sport.sport}
              figure={figure}
              setFigure={setFigure}
            />
          ))}
        </View>
      </View>
    </>
  );
}

/**
 * The figures the engine judges the athlete's rides and runs against, each set
 * by hand or read from the sport settings or the activity files, and the
 * percentages Veloq's heart rate zones default to.
 */
export function AthleteThresholds() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { data, failed, setFigure } = useThresholdsScreen();
  const note = { color: isDark ? darkColors.textSecondary : colors.textSecondary };
  if (failed) {
    return (
      <Text style={[styles.note, note]} testID="athlete-thresholds-failed">
        {t('thresholds.loadFailed')}
      </Text>
    );
  }
  if (!data) return null;

  return (
    <View testID="athlete-thresholds">
      <Text style={[styles.note, note]}>{t('thresholds.description')}</Text>
      {data.sports.map((sport) => (
        <SportThresholds key={sport.sport} sport={sport} setFigure={setFigure} />
      ))}
      <ListSectionHeader testID="threshold-zones-header">{t('thresholds.zones')}</ListSectionHeader>
      <Text style={[styles.note, note]} testID="threshold-zone-defaults">
        {t('thresholds.zoneDefaults', {
          percents: data.hrZoneDefaultPercents.join(', '),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { padding: spacing.md, gap: spacing.md },
  note: {
    ...typography.bodySmall,
    marginHorizontal: layout.screenPadding,
    marginVertical: spacing.sm,
  },
});
