import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useExportDatabaseBackup,
  useImportDatabaseBackup,
  useExportBackup,
  useImportBackup,
  useBulkExport,
} from '@/hooks';
import { formatFileSize } from '@/lib';
import { useTheme } from '@/hooks';
import { getRouteEngine } from '@/lib/native/routeEngine';
import {
  isAutoBackupEnabled,
  setAutoBackupEnabled,
  getLastBackupTimestamp,
  performBackup,
  getConfiguredBackend,
  setBackendPreference,
  getAvailableBackends,
  getWebdavConfig,
  setWebdavConfig,
  testWebdavConnection,
  type BackupBackend,
} from '@/lib/backup';
import { colors, darkColors, spacing, layout } from '@/theme';

export function BackupSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Auto-backup state
  const [autoEnabled, setAutoEnabled] = useState(() => isAutoBackupEnabled());
  const [backingUp, setBackingUp] = useState(false);
  const lastBackupTs = useMemo(() => getLastBackupTimestamp(), [backingUp]);

  const handleToggleAutoBackup = useCallback((value: boolean) => {
    setAutoBackupEnabled(value);
    setAutoEnabled(value);
  }, []);

  const handleBackupNow = useCallback(async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      await performBackup(true);
    } finally {
      setBackingUp(false);
    }
  }, [backingUp]);

  // Backend picker state
  const [currentBackend, setCurrentBackend] = useState(() => getConfiguredBackend());
  const [showBackendPicker, setShowBackendPicker] = useState(false);
  const [availableBackends, setAvailableBackends] = useState<BackupBackend[]>([]);

  // WebDAV config state
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPass, setWebdavPass] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    getAvailableBackends().then(setAvailableBackends);
    const config = getWebdavConfig();
    if (config) {
      setWebdavUrl(config.url);
      setWebdavUser(config.username);
      setWebdavPass(config.password);
    }
  }, []);

  const handleSelectBackend = useCallback(
    (backend: BackupBackend) => {
      setBackendPreference(backend.id);
      setCurrentBackend(backend);
      setShowBackendPicker(false);
    },
    []
  );

  const handleSaveWebdav = useCallback(async () => {
    if (!webdavUrl || !webdavUser || !webdavPass) return;
    await setWebdavConfig(webdavUrl, webdavUser, webdavPass);
    // Refresh available backends since WebDAV is now configured
    getAvailableBackends().then(setAvailableBackends);
  }, [webdavUrl, webdavUser, webdavPass]);

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    // Save first so the test uses current values
    await handleSaveWebdav();
    const error = await testWebdavConnection();
    setTestingConnection(false);
    if (error) {
      Alert.alert(t('backup.connectionFailed'), error);
    } else {
      Alert.alert(t('backup.connectionSuccess'));
    }
  }, [handleSaveWebdav, t]);

  // Database backup (primary)
  const { exportDatabaseBackup, exporting: dbExporting } = useExportDatabaseBackup();
  const { importDatabaseBackup, importing: dbImporting } = useImportDatabaseBackup();

  // Legacy JSON backup
  const { exportBackup: legacyExport, exporting: legacyExporting } = useExportBackup();
  const { importBackup: legacyImport, importing: legacyImporting } = useImportBackup();

  // Bulk export
  const {
    exportAll,
    exportAllGeoJson,
    isExporting: bulkExporting,
    phase: bulkPhase,
    current: bulkCurrent,
    total: bulkTotal,
    sizeBytes: bulkSizeBytes,
  } = useBulkExport();

  const totalActivities = useMemo(() => getRouteEngine()?.getActivityCount() ?? 0, []);

  const lastBackupText = lastBackupTs
    ? t('backup.lastBackup', { date: new Date(lastBackupTs).toLocaleDateString() })
    : t('backup.lastBackupNever');

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('backup.autoBackup').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Auto-backup toggle */}
        <View style={styles.actionRow}>
          <MaterialCommunityIcons
            name="cloud-sync-outline"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('backup.autoBackup')}
            </Text>
            <Text style={[styles.subtitleText, isDark && styles.textMuted]}>
              {t('backup.autoBackupDescription')}
            </Text>
          </View>
          <Switch
            value={autoEnabled}
            onValueChange={handleToggleAutoBackup}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>

        {/* Backend picker */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => setShowBackendPicker(true)}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons
            name="folder-network-outline"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {t('backup.selectBackend')}
          </Text>
          <Text style={[styles.backendValue, isDark && styles.textMuted]}>
            {currentBackend.name}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        {/* WebDAV config (shown when WebDAV is selected) */}
        {currentBackend.id === 'webdav' && (
          <View style={[styles.configBlock, isDark && styles.configBlockDark]}>
            <TextInput
              style={[styles.input, isDark && styles.inputDark]}
              placeholder={t('backup.serverUrl')}
              placeholderTextColor={isDark ? darkColors.textMuted : colors.textSecondary}
              value={webdavUrl}
              onChangeText={setWebdavUrl}
              onBlur={handleSaveWebdav}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextInput
              style={[styles.input, isDark && styles.inputDark]}
              placeholder={t('backup.username')}
              placeholderTextColor={isDark ? darkColors.textMuted : colors.textSecondary}
              value={webdavUser}
              onChangeText={setWebdavUser}
              onBlur={handleSaveWebdav}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={[styles.input, isDark && styles.inputDark]}
              placeholder={t('backup.password')}
              placeholderTextColor={isDark ? darkColors.textMuted : colors.textSecondary}
              value={webdavPass}
              onChangeText={setWebdavPass}
              onBlur={handleSaveWebdav}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.testButton, testingConnection && { opacity: 0.5 }]}
              onPress={handleTestConnection}
              disabled={testingConnection || !webdavUrl}
              activeOpacity={0.6}
            >
              <Text style={styles.testButtonText}>
                {testingConnection ? '...' : t('backup.testConnection')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Backend picker modal */}
        <Modal
          visible={showBackendPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowBackendPicker(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowBackendPicker(false)}
          >
            <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
              <Text style={[styles.modalTitle, isDark && styles.textLight]}>
                {t('backup.selectBackend')}
              </Text>
              {[
                { id: 'local', name: t('backup.backendLocal'), icon: 'cellphone' as const },
                { id: 'webdav', name: t('backup.backendWebdav'), icon: 'server-network' as const },
                ...(Platform.OS === 'ios'
                  ? [{ id: 'icloud', name: t('backup.backendIcloud'), icon: 'apple-icloud' as const }]
                  : []),
              ].map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.modalOption,
                    currentBackend.id === option.id && styles.modalOptionSelected,
                  ]}
                  onPress={() => {
                    const backend =
                      availableBackends.find((b) => b.id === option.id) ??
                      (option.id === 'webdav'
                        ? { id: 'webdav', name: 'WebDAV' }
                        : { id: 'local', name: 'Local Storage' });
                    handleSelectBackend(backend as BackupBackend);
                  }}
                  activeOpacity={0.6}
                >
                  <MaterialCommunityIcons
                    name={option.icon}
                    size={20}
                    color={
                      currentBackend.id === option.id
                        ? colors.primary
                        : isDark
                          ? darkColors.textSecondary
                          : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.modalOptionText,
                      isDark && styles.textLight,
                      currentBackend.id === option.id && { color: colors.primary },
                    ]}
                  >
                    {option.name}
                  </Text>
                  {currentBackend.id === option.id && (
                    <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Last backup status */}
        <View style={[styles.statusRow, isDark && styles.statusRowDark]}>
          <Text style={[styles.statusText, isDark && styles.textMuted]}>{lastBackupText}</Text>
          <TouchableOpacity onPress={handleBackupNow} disabled={backingUp} activeOpacity={0.2}>
            <Text style={[styles.linkText, backingUp && styles.linkTextDisabled]}>
              {backingUp ? t('backup.backingUp') : t('backup.backupNow')}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Database export */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={dbExporting ? undefined : exportDatabaseBackup}
          disabled={dbExporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="database-export-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {dbExporting ? t('backup.exportingDatabase') : t('backup.exportDatabase')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Database import */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={dbImporting ? undefined : importDatabaseBackup}
          disabled={dbImporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="database-import-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {dbImporting ? t('backup.importingDatabase') : t('backup.importDatabase')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Legacy JSON export */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={legacyExporting ? undefined : legacyExport}
          disabled={legacyExporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="cloud-upload-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {legacyExporting ? t('backup.exporting') : t('backup.exportBackup')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Legacy JSON import */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={legacyImporting ? undefined : legacyImport}
          disabled={legacyImporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="cloud-download-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {legacyImporting ? t('backup.importing') : t('backup.importBackup')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Bulk activity export */}
        <View style={styles.actionRow}>
          <MaterialCommunityIcons name="map-marker-path" size={22} color={colors.primary} />
          {bulkExporting ? (
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionText, isDark && styles.textLight]}>
                {bulkPhase === 'sharing'
                  ? t('export.bulkSharing')
                  : t('export.bulkExporting', { current: bulkCurrent, total: bulkTotal })}
              </Text>
              <View
                style={[styles.progressBarContainer, isDark && styles.progressBarContainerDark]}
              >
                <View
                  style={[
                    styles.progressBar,
                    {
                      width:
                        bulkTotal > 0 ? `${Math.round((bulkCurrent / bulkTotal) * 100)}%` : '0%',
                    },
                  ]}
                />
              </View>
              <Text style={[styles.progressDetail, isDark && styles.textMuted]}>
                {bulkTotal > 0 ? `${Math.round((bulkCurrent / bulkTotal) * 100)}%` : '0%'}
                {bulkSizeBytes > 0 && ` · ${formatFileSize(bulkSizeBytes)}`}
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.actionText, isDark && styles.textLight]}>
                {t('export.bulkExport', { count: totalActivities })}
              </Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, isDark && styles.pillDark]}
                  onPress={exportAll}
                  activeOpacity={0.6}
                >
                  <Text style={styles.pillText}>GPX</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pill, isDark && styles.pillDark]}
                  onPress={exportAllGeoJson}
                  activeOpacity={0.6}
                >
                  <Text style={styles.pillText}>GeoJSON</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  subtitleText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  statusRowDark: {
    backgroundColor: darkColors.background,
  },
  statusText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  linkText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  linkTextDisabled: {
    opacity: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressBarContainerDark: {
    backgroundColor: darkColors.border,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressDetail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  pillDark: {
    backgroundColor: colors.primary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  backendValue: {
    fontSize: 14,
    color: colors.textSecondary,
    marginRight: 4,
  },
  configBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  configBlockDark: {},
  input: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputDark: {
    borderColor: darkColors.border,
    color: colors.textOnDark,
    backgroundColor: darkColors.background,
  },
  testButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  testButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
  },
  modalContentDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  modalOptionSelected: {
    backgroundColor: 'rgba(252, 76, 2, 0.08)',
  },
  modalOptionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
