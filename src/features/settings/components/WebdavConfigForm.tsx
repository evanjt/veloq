import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Switch, TextInput, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import {
  getWebdavConfig,
  setWebdavConfig,
  clearWebdavConfig,
  testWebdavConnection,
  webdavUrlProblem,
} from '@/features/settings/lib/autobackup';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { NextcloudQrScanner } from './NextcloudQrScanner';
import { InfoButton } from './InfoButton';
import { webdavTestMessage } from '../lib/autobackup/webdavTestMessage';

interface WebdavConfigFormProps {
  /** The stored credentials changed, so whatever lists backends should read them again. */
  onConfigChange: () => void;
  /** The credentials were removed. */
  onRemoved: () => void;
}

/** The WebDAV server fields, Nextcloud QR setup and connection test. */
export function WebdavConfigForm({ onConfigChange, onRemoved }: WebdavConfigFormProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // WebDAV config state, read at first render so the fields paint filled in
  // rather than empty and then replaced a frame later. `getWebdavConfig` is the
  // in-memory cache `initWebdavConfig` filled at startup, so this is a property
  // read and not a SecureStore round trip.
  const [storedWebdav] = useState(getWebdavConfig);
  const [webdavUrl, setWebdavUrl] = useState(storedWebdav?.url ?? '');
  const [webdavUser, setWebdavUser] = useState(storedWebdav?.username ?? '');
  const [webdavPass, setWebdavPass] = useState(storedWebdav?.password ?? '');
  const [webdavPlainLan, setWebdavPlainLan] = useState(storedWebdav?.plainLan ?? false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<'success' | 'error' | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);

  // Basic credentials and the record archive cross on every backup, so an
  // address that would carry them in the clear is refused before it is stored.
  const urlProblemText = useCallback(
    (url: string, plainLan: boolean): string | null => {
      const problem = webdavUrlProblem(url, plainLan);
      if (problem === 'not-https') {
        return t(
          'backup.webdavHttpsRequired',
          'Use an https:// address. An http:// server would receive your password and record archive unencrypted.'
        );
      }
      if (problem === 'invalid') {
        return t('backup.webdavInvalidUrl', 'That is not a valid server address');
      }
      return null;
    },
    [t]
  );

  const handleSaveWebdav = useCallback(async (): Promise<boolean> => {
    if (!webdavUrl || !webdavUser || !webdavPass) return false;
    const refused = urlProblemText(webdavUrl, webdavPlainLan);
    if (refused) {
      setConnectionResult('error');
      setConnectionError(refused);
      return false;
    }
    await setWebdavConfig(webdavUrl, webdavUser, webdavPass, webdavPlainLan);
    // Refresh the offer list since WebDAV is now configured
    onConfigChange();
    return true;
  }, [webdavUrl, webdavUser, webdavPass, webdavPlainLan, urlProblemText, onConfigChange]);

  const handleRemoveWebdav = useCallback(async () => {
    await clearWebdavConfig();
    setWebdavUrl('');
    setWebdavUser('');
    setWebdavPass('');
    setWebdavPlainLan(false);
    setConnectionResult(null);
    setConnectionError(null);
    onRemoved();
  }, [onRemoved]);

  const handleTogglePlainLan = useCallback((value: boolean) => {
    setWebdavPlainLan(value);
    setConnectionResult(null);
    setConnectionError(null);
  }, []);
  const plainHttp = /^\s*http:/i.test(webdavUrl);

  const handleQrScanned = useCallback(
    (data: string) => {
      // Parse nc://login/user:USERNAME&password:PASSWORD&server:SERVER_URL
      if (!data.startsWith('nc://login/')) {
        setConnectionResult('error');
        setConnectionError(t('backup.invalidQrCode', 'Not a valid Nextcloud QR code'));
        setShowQrScanner(false);
        return;
      }
      const params = data.slice('nc://login/'.length);
      const parts: Record<string, string> = {};
      for (const part of params.split('&')) {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0) {
          parts[part.slice(0, colonIdx)] = part.slice(colonIdx + 1);
        }
      }
      const user = parts.user;
      const password = parts.password;
      const server = parts.server;
      if (!user || !password || !server) {
        setConnectionResult('error');
        setConnectionError(t('backup.invalidQrCode', 'Not a valid Nextcloud QR code'));
        setShowQrScanner(false);
        return;
      }
      // Construct WebDAV URL per Nextcloud docs
      const baseUrl = server.endsWith('/') ? server.slice(0, -1) : server;
      const webdavEndpoint = `${baseUrl}/remote.php/dav/files/${user}/`;
      setWebdavUrl(webdavEndpoint);
      setWebdavUser(user);
      setWebdavPass(password);
      setShowQrScanner(false);
      const refused = urlProblemText(webdavEndpoint, webdavPlainLan);
      if (refused) {
        setConnectionResult('error');
        setConnectionError(refused);
        return;
      }
      setConnectionResult(null);
      // Auto-save config
      setWebdavConfig(webdavEndpoint, user, password, webdavPlainLan).then(() => {
        onConfigChange();
      });
    },
    [t, urlProblemText, webdavPlainLan, onConfigChange]
  );

  const handleTestConnection = useCallback(async () => {
    if (!webdavUrl || !webdavUser || !webdavPass) {
      setConnectionResult('error');
      setConnectionError(t('backup.fillAllFields', 'Please fill in all fields'));
      return;
    }
    setTestingConnection(true);
    setConnectionResult(null);
    setConnectionError(null);
    if (!(await handleSaveWebdav())) {
      setTestingConnection(false);
      return;
    }
    const outcome = await testWebdavConnection();
    setTestingConnection(false);
    if (outcome.kind === 'ok') {
      setConnectionResult('success');
      return;
    }
    setConnectionResult('error');
    setConnectionError(webdavTestMessage(outcome, t, urlProblemText(webdavUrl, webdavPlainLan)));
  }, [handleSaveWebdav, urlProblemText, webdavUrl, webdavUser, webdavPass, webdavPlainLan, t]);

  return (
    <>
      <View style={[styles.configBlock, isDark && styles.configBlockDark]}>
        <View style={styles.qrRow}>
          <Button
            label={t('backup.scanNextcloudQr', 'Scan Nextcloud App Password')}
            variant="secondary"
            size="sm"
            icon={<MaterialCommunityIcons name="qrcode-scan" size={18} color={colors.primary} />}
            onPress={() => setShowQrScanner(true)}
          />
          <InfoButton
            testID="backup-info-nextcloud"
            title={t('backup.scanNextcloudQr', 'Scan Nextcloud App Password')}
            message={t(
              'backup.nextcloudQrHint',
              'Nextcloud → Settings → Security → Create new app password → Scan QR code'
            )}
          />
        </View>
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
        {plainHttp && (
          <View style={styles.plainLanRow}>
            <Text style={[styles.plainLanText, isDark && styles.textMuted]}>
              {t('backup.webdavPlainLan', 'Allow an unencrypted server on my own network')}
            </Text>
            <Switch
              value={webdavPlainLan}
              onValueChange={handleTogglePlainLan}
              trackColor={{ false: colors.border, true: colors.primary }}
              testID="backup-webdav-plain-lan"
            />
          </View>
        )}
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
        <View style={styles.testRow}>
          {getWebdavConfig() && (
            <Button
              testID="backup-remove-webdav"
              label={t('common.remove')}
              variant="destructive"
              size="sm"
              onPress={handleRemoveWebdav}
            />
          )}
          <Button
            label={t('backup.testConnection')}
            variant="primary"
            size="sm"
            onPress={handleTestConnection}
            loading={testingConnection}
          />
          {connectionResult === 'success' && (
            <Text
              style={[
                styles.connectionSuccess,
                { color: isDark ? darkColors.successDeep : colors.successDeep },
              ]}
            >
              {t('backup.connectionSuccess')}
            </Text>
          )}
          {connectionResult === 'error' && (
            <Text style={[styles.connectionError, isDark && styles.connectionErrorDark]}>
              {connectionError || t('backup.connectionFailed')}
            </Text>
          )}
        </View>
      </View>
      <Modal
        visible={showQrScanner}
        animationType="slide"
        onRequestClose={() => setShowQrScanner(false)}
      >
        <NextcloudQrScanner onScanned={handleQrScanned} onClose={() => setShowQrScanner(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    ...typography.body,
    height: layout.minTapTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputDark: {
    borderColor: darkColors.border,
    color: colors.textOnDark,
    backgroundColor: darkColors.background,
  },
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  plainLanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  plainLanText: {
    ...typography.caption,
    flex: 1,
    color: colors.textSecondary,
  },
  configBlockDark: {},
  configBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  connectionSuccess: {
    ...typography.caption,
  },
  connectionError: {
    ...typography.caption,
    color: colors.errorDeep,
  },
  connectionErrorDark: {
    color: darkColors.errorDeep,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
