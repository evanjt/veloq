/**
 * The collection import screen: choose files, an archive or (on Android) a folder, then follow the
 * job's counts, the entry in hand and, at the end, each file that failed and why. A cancel keeps
 * what is stored.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { FfiImportHalt_Tags, FfiImportPhase, type FfiImportProgress } from 'veloqrs';

import { Button, Row } from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';

import { useImportCollection } from '../hooks/useImportCollection';

interface ImportCollectionProps {
  isDark: boolean;
}

function titleKey(progress: FfiImportProgress) {
  switch (progress.phase) {
    case FfiImportPhase.Running:
      return 'importCollection.runningTitle' as const;
    case FfiImportPhase.Cancelled:
      return 'importCollection.cancelledTitle' as const;
    default:
      return 'importCollection.doneTitle' as const;
  }
}

export function ImportCollection({ isDark }: ImportCollectionProps) {
  const { t } = useTranslation();
  const { progress, running, refused, pickFiles, pickArchive, pickFolder, cancel } =
    useImportCollection();
  const text = isDark ? styles.textLight : undefined;
  const secondary = isDark ? styles.textSecondaryDark : styles.textSecondary;

  const counts = progress
    ? [
        { name: 'seen', label: t('importCollection.seen'), value: progress.seen },
        { name: 'stored', label: t('importCollection.stored'), value: progress.stored },
        {
          name: 'alreadyStored',
          label: t('importCollection.alreadyStored'),
          value: progress.alreadyStored,
        },
        { name: 'failed', label: t('importCollection.failed'), value: progress.failed },
        {
          name: 'otherFormat',
          label: t('importCollection.otherFormat'),
          value: progress.otherFormat,
        },
      ]
    : [];
  const halt = progress?.halt;
  const haltText =
    halt?.tag === FfiImportHalt_Tags.Unreadable
      ? t('importCollection.unreadable', { reason: halt.inner.reason })
      : halt?.tag === FfiImportHalt_Tags.Unstorable
        ? t('importCollection.unstorable')
        : null;

  return (
    <View testID="import-collection">
      <Text style={[styles.intro, secondary]}>{t('importCollection.intro')}</Text>
      <View style={styles.buttons}>
        <Button
          testID="import-collection-files"
          label={t('importCollection.chooseFiles')}
          onPress={pickFiles}
          disabled={running}
        />
        <Button
          testID="import-collection-archive"
          label={t('importCollection.chooseArchive')}
          onPress={pickArchive}
          disabled={running}
          variant="secondary"
        />
        {Platform.OS === 'android' ? (
          <Button
            testID="import-collection-folder"
            label={t('importCollection.chooseFolder')}
            onPress={pickFolder}
            disabled={running}
            variant="secondary"
          />
        ) : null}
      </View>
      {refused ? (
        <Text testID="import-collection-refused" style={[styles.line, secondary]}>
          {t('importCollection.refused')}
        </Text>
      ) : null}
      {progress && progress.phase !== FfiImportPhase.Idle ? (
        <View testID="import-collection-progress">
          <Row>
            <Text style={[styles.title, text]}>{t(titleKey(progress))}</Text>
          </Row>
          {counts.map(({ name, label, value }) => (
            <Row key={name} testID={`import-collection-${name}`}>
              <Text style={[styles.label, secondary]}>{label}</Text>
              <Text style={[styles.value, text]}>{value}</Text>
            </Row>
          ))}
          {running && progress.current ? (
            <Text testID="import-collection-current" style={[styles.line, secondary]}>
              {t('importCollection.current')}: {progress.current}
            </Text>
          ) : null}
          {haltText ? (
            <Text testID="import-collection-halt" style={[styles.line, secondary]}>
              {haltText}
            </Text>
          ) : null}
          {running ? (
            <Button
              testID="import-collection-cancel"
              label={t('importCollection.cancel')}
              onPress={cancel}
              variant="ghost"
            />
          ) : null}
          {!running && progress.failures.length ? (
            <View testID="import-collection-failures">
              <Text style={[styles.title, text]}>{t('importCollection.failedHeading')}</Text>
              {progress.failures.map((failure, index) => (
                <Text key={`${failure.name}-${index}`} style={[styles.line, secondary]}>
                  {failure.name}: {failure.reason}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { ...typography.body, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  buttons: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  title: { ...typography.bodyBold, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  label: { ...typography.bodySmall, flex: 1 },
  value: { ...typography.bodySmallBold },
  line: { ...typography.bodySmall, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  textLight: { color: colors.textOnFill },
  textSecondary: { color: colors.textSecondary },
  textSecondaryDark: { color: darkColors.textSecondary },
});
