import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, Text } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, layout, cameraOverlay, typography, colorWithOpacity, ink } from '@/theme';
import { permissionOutcome } from '@/shared/app/permissions';
import { Button, IconButton, PermissionNotice } from '@/shared/ui';
import { parseNextcloudLogin, type NextcloudLogin } from '../lib/autobackup/nextcloudLogin';

/** How long a code that is not a login stays named before the camera reads again. */
const MISMATCH_PAUSE_MS = 1000;

interface NextcloudQrScannerProps {
  /** Called once, with the first code that reads as a Nextcloud login. */
  onScanned: (login: NextcloudLogin) => void;
  onClose: () => void;
  /** Closes the scanner for the typed fields, which need no camera. */
  onEnterDetails: () => void;
}

export function NextcloudQrScanner({
  onScanned,
  onClose,
  onEnterDetails,
}: NextcloudQrScannerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    []
  );

  // A sheet of codes, or a Wi-Fi code beside the login, is read before the one
  // wanted, so a code that is not a login is named and the camera reads on.
  const handleCode = (data: string) => {
    setScanned(true);
    const login = parseNextcloudLogin(data);
    if (login) {
      onScanned(login);
      return;
    }
    setMismatch(true);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      setMismatch(false);
      setScanned(false);
    }, MISMATCH_PAUSE_MS);
  };

  // Coming back from system settings is where a blocked camera gets allowed,
  // so the viewfinder opens then rather than on the next visit.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  const outcome = permissionOutcome(permission);
  if (outcome !== 'granted') {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialCommunityIcons name="camera-off" size={48} color={cameraOverlay.hint} />
        <PermissionNotice
          testID="nextcloud-scanner-camera"
          outcome={outcome}
          icon="camera-outline"
          reason={
            outcome === 'blocked'
              ? t('permissionNotice.cameraOff')
              : t('backup.cameraPermissionNeeded', 'Camera access is required to scan QR codes')
          }
          onAllow={() => void requestPermission()}
        />
        <Button
          label={t('backup.enterDetailsInstead')}
          onPress={onEnterDetails}
          variant="secondary"
        />
        <Button label={t('common.cancel')} onPress={onClose} variant="ghost" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        enableTorch={torchOn}
        onBarcodeScanned={scanned ? undefined : ({ data }) => handleCode(data)}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton accessibilityLabel={t('common.close')} onPress={onClose}>
          <MaterialCommunityIcons name="close" size={24} color={cameraOverlay.text} />
        </IconButton>
        <Text style={styles.headerTitle}>{t('backup.scanQrTitle', 'Scan Nextcloud QR Code')}</Text>
        <IconButton
          accessibilityLabel={torchOn ? t('backup.torchOff') : t('backup.torchOn')}
          accessibilityState={{ checked: torchOn }}
          onPress={() => setTorchOn((on) => !on)}
        >
          <MaterialCommunityIcons
            name={torchOn ? 'flashlight-off' : 'flashlight'}
            size={24}
            color={cameraOverlay.text}
          />
        </IconButton>
      </View>

      {/* Instructions */}
      <View style={[styles.instructions, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.instructionText}>
          {t(
            'backup.scanQrInstructions',
            'In Nextcloud, go to Settings → Security → Create new app password, then scan the QR code shown.'
          )}
        </Text>
      </View>

      {/* Viewfinder overlay */}
      <View style={styles.viewfinder}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
        {mismatch ? (
          <View style={styles.mismatch} accessibilityLiveRegion="polite">
            <Text style={styles.mismatchText} accessibilityRole="alert">
              {t('backup.invalidQrCode', 'Not a valid Nextcloud QR code')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cameraOverlay.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colorWithOpacity(ink.black, 0.5),
  },
  headerTitle: {
    ...typography.cardTitle,
    color: cameraOverlay.text,
  },
  instructions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colorWithOpacity(ink.black, 0.6),
    padding: spacing.lg,
  },
  instructionText: {
    ...typography.bodySmall,
    color: cameraOverlay.text,
    textAlign: 'center',
  },
  mismatch: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    padding: spacing.sm,
  },
  mismatchText: {
    ...typography.bodySmall,
    color: cameraOverlay.text,
    textAlign: 'center',
    backgroundColor: colorWithOpacity(ink.black, 0.6),
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  viewfinder: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    width: '70%',
    height: '30%',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: cameraOverlay.text,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: cameraOverlay.text,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: cameraOverlay.text,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: cameraOverlay.text,
  },
});
